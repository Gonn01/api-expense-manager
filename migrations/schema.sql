--
-- PostgreSQL database dump
--

\restrict ArL57PoOKyOvu7XZjcEmub3ao5AOPloNwArfKkfOFAiPTbvNj8jW6aHXkhhKA4t

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: currency; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.currency AS ENUM (
    'ARS',
    'USD',
    'EUR',
    'AUD',
    'AWG',
    'BOB',
    'CAD',
    'CHF',
    'CNH',
    'CNY',
    'COP',
    'CZK',
    'DKK',
    'GBP',
    'HKD',
    'ILS',
    'INR',
    'JPY',
    'MXN',
    'NIO',
    'NOK',
    'NZD',
    'PEN',
    'PYG',
    'RSD',
    'RUB',
    'SEK',
    'SGD',
    'TRY',
    'VES',
    'VND',
    'XDR',
    'ZAR',
    'BRL',
    'CLP',
    'UYU'
);


--
-- Name: expense_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.expense_type AS ENUM (
    'EGRESO',
    'INGRESO'
);


--
-- Name: movement_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.movement_type AS ENUM (
    'CREATION',
    'PAYMENT',
    'REFUND',
    'PENDING_PAYMENT',
    'EDITED',
    'RESTORE',
    'DELETE',
    'LINK',
    'UNLINK',
    'PURCHASE_CREATED',
    'POSTPONED',
    'UNPOSTPONED',
    'PAYMENT_REJECTED',
    'PAYMENT_WITHDRAWN',
    'PAYMENT_REQUESTED',
    'PAYMENT_REVERTED',
    'REVERSAL_REQUESTED',
    'REVERSAL_CANCELLED',
    'REVERSAL_REJECTED',
    'SHARED_APPROVED',
    'SHARED_REJECTED',
    'SHARED_RETRIED',
    'EDIT_REQUESTED',
    'EDIT_APPROVED',
    'EDIT_REJECTED',
    'EDIT_CANCELLED'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: user_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_categories (
    id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    user_id bigint NOT NULL,
    name text NOT NULL,
    color text,
    deleted boolean DEFAULT false
);


--
-- Name: categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.categories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.categories_id_seq OWNED BY public.user_categories.id;


--
-- Name: financial_entities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.financial_entities (
    id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    name text NOT NULL,
    user_id bigint NOT NULL,
    deleted boolean DEFAULT false NOT NULL,
    linked_user_id bigint,
    is_favorite boolean DEFAULT false NOT NULL
);


--
-- Name: financial_entities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.financial_entities ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.financial_entities_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: financial_entities_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.financial_entities_movements (
    id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    financial_entity_id bigint NOT NULL,
    movement_type public.movement_type,
    detail text
);


--
-- Name: financial_entities_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.financial_entities_movements ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.financial_entities_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: purchase_edit_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_edit_requests (
    id integer NOT NULL,
    purchase_id integer NOT NULL,
    sibling_purchase_id integer NOT NULL,
    requested_by_user_id integer NOT NULL,
    counterparty_user_id integer NOT NULL,
    changes jsonb NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by_user_id integer,
    CONSTRAINT purchase_edit_requests_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'CANCELLED'::text])))
);


--
-- Name: purchase_edit_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.purchase_edit_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: purchase_edit_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.purchase_edit_requests_id_seq OWNED BY public.purchase_edit_requests.id;


--
-- Name: purchases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchases (
    id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    image_url text,
    amount numeric NOT NULL,
    number_of_quotas bigint NOT NULL,
    currency_type public.currency NOT NULL,
    name text NOT NULL,
    financial_entity_id bigint,
    fixed_expense boolean DEFAULT false NOT NULL,
    deleted boolean DEFAULT false NOT NULL,
    type public.expense_type,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    shared_from_id bigint,
    receiver_user_id bigint,
    linked_purchase_id integer,
    is_postponed boolean DEFAULT false NOT NULL,
    is_favorite boolean DEFAULT false NOT NULL,
    deleted_with_entity boolean DEFAULT false NOT NULL
);


--
-- Name: purchases_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchases_categories (
    purchase_id bigint NOT NULL,
    category_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: purchases_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.purchases ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.purchases_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: purchases_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchases_movements (
    id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    purchase_id bigint NOT NULL,
    movement_type public.movement_type,
    amount numeric,
    payment_date timestamp with time zone DEFAULT now(),
    created_by_user_id integer,
    detail text,
    paired_movement_id integer,
    reversal_requested_by_user_id integer,
    reversal_requested_at timestamp with time zone
);


--
-- Name: purchases_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.purchases_movements ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.purchases_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: settlement_session_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settlement_session_items (
    id integer NOT NULL,
    session_id integer NOT NULL,
    purchase_id integer NOT NULL,
    auto boolean DEFAULT false NOT NULL,
    checked_at timestamp with time zone DEFAULT now() NOT NULL,
    quota_number integer
);


--
-- Name: settlement_session_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.settlement_session_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: settlement_session_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.settlement_session_items_id_seq OWNED BY public.settlement_session_items.id;


--
-- Name: settlement_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settlement_sessions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone
);


--
-- Name: settlement_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.settlement_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: settlement_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.settlement_sessions_id_seq OWNED BY public.settlement_sessions.id;


--
-- Name: settlement_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settlement_snapshots (
    id integer NOT NULL,
    user_id integer NOT NULL,
    session_id integer,
    month text NOT NULL,
    started_at timestamp with time zone NOT NULL,
    finished_at timestamp with time zone NOT NULL,
    totals jsonb NOT NULL,
    items jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: settlement_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.settlement_snapshots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: settlement_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.settlement_snapshots_id_seq OWNED BY public.settlement_snapshots.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    name text,
    email text NOT NULL,
    firebase_user_id text DEFAULT 'a'::text,
    password text,
    avatar text,
    preferred_currency public.currency,
    sueldo numeric,
    sueldo_currency public.currency
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.users ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: purchase_edit_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_edit_requests ALTER COLUMN id SET DEFAULT nextval('public.purchase_edit_requests_id_seq'::regclass);


--
-- Name: settlement_session_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_session_items ALTER COLUMN id SET DEFAULT nextval('public.settlement_session_items_id_seq'::regclass);


--
-- Name: settlement_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_sessions ALTER COLUMN id SET DEFAULT nextval('public.settlement_sessions_id_seq'::regclass);


--
-- Name: settlement_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_snapshots ALTER COLUMN id SET DEFAULT nextval('public.settlement_snapshots_id_seq'::regclass);


--
-- Name: user_categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_categories ALTER COLUMN id SET DEFAULT nextval('public.categories_id_seq'::regclass);


--
-- Name: user_categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: user_categories categories_user_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_categories
    ADD CONSTRAINT categories_user_id_name_key UNIQUE (user_id, name);


--
-- Name: financial_entities_movements financial_entities_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_entities_movements
    ADD CONSTRAINT financial_entities_logs_pkey PRIMARY KEY (id);


--
-- Name: financial_entities financial_entities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_entities
    ADD CONSTRAINT financial_entities_pkey PRIMARY KEY (id);


--
-- Name: purchase_edit_requests purchase_edit_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_edit_requests
    ADD CONSTRAINT purchase_edit_requests_pkey PRIMARY KEY (id);


--
-- Name: purchases_categories purchases_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases_categories
    ADD CONSTRAINT purchases_categories_pkey PRIMARY KEY (purchase_id, category_id);


--
-- Name: purchases_movements purchases_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases_movements
    ADD CONSTRAINT purchases_logs_pkey PRIMARY KEY (id);


--
-- Name: purchases purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_pkey PRIMARY KEY (id);


--
-- Name: settlement_session_items settlement_session_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_session_items
    ADD CONSTRAINT settlement_session_items_pkey PRIMARY KEY (id);


--
-- Name: settlement_session_items settlement_session_items_session_id_purchase_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_session_items
    ADD CONSTRAINT settlement_session_items_session_id_purchase_id_key UNIQUE (session_id, purchase_id);


--
-- Name: settlement_sessions settlement_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_sessions
    ADD CONSTRAINT settlement_sessions_pkey PRIMARY KEY (id);


--
-- Name: settlement_snapshots settlement_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_snapshots
    ADD CONSTRAINT settlement_snapshots_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: purchase_edit_requests_counterparty; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX purchase_edit_requests_counterparty ON public.purchase_edit_requests USING btree (counterparty_user_id) WHERE (status = 'PENDING'::text);


--
-- Name: purchase_edit_requests_one_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX purchase_edit_requests_one_pending ON public.purchase_edit_requests USING btree (LEAST(purchase_id, sibling_purchase_id), GREATEST(purchase_id, sibling_purchase_id)) WHERE (status = 'PENDING'::text);


--
-- Name: purchase_edit_requests_requested_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX purchase_edit_requests_requested_by ON public.purchase_edit_requests USING btree (requested_by_user_id) WHERE (status = 'PENDING'::text);


--
-- Name: purchases_entity_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX purchases_entity_status_idx ON public.purchases USING btree (financial_entity_id, status) WHERE (deleted = false);


--
-- Name: purchases_movements_purchase_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX purchases_movements_purchase_type_idx ON public.purchases_movements USING btree (purchase_id, movement_type);


--
-- Name: settlement_sessions_one_open; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX settlement_sessions_one_open ON public.settlement_sessions USING btree (user_id) WHERE (status = 'OPEN'::text);


--
-- Name: settlement_snapshots_user_month; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX settlement_snapshots_user_month ON public.settlement_snapshots USING btree (user_id, month);


--
-- Name: user_categories categories_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_categories
    ADD CONSTRAINT categories_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: financial_entities financial_entities_linked_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_entities
    ADD CONSTRAINT financial_entities_linked_user_id_fkey FOREIGN KEY (linked_user_id) REFERENCES public.users(id);


--
-- Name: financial_entities_movements financial_entities_logs_financial_entity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_entities_movements
    ADD CONSTRAINT financial_entities_logs_financial_entity_id_fkey FOREIGN KEY (financial_entity_id) REFERENCES public.financial_entities(id);


--
-- Name: financial_entities financial_entities_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_entities
    ADD CONSTRAINT financial_entities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: purchase_edit_requests purchase_edit_requests_counterparty_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_edit_requests
    ADD CONSTRAINT purchase_edit_requests_counterparty_user_id_fkey FOREIGN KEY (counterparty_user_id) REFERENCES public.users(id);


--
-- Name: purchase_edit_requests purchase_edit_requests_purchase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_edit_requests
    ADD CONSTRAINT purchase_edit_requests_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.purchases(id);


--
-- Name: purchase_edit_requests purchase_edit_requests_requested_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_edit_requests
    ADD CONSTRAINT purchase_edit_requests_requested_by_user_id_fkey FOREIGN KEY (requested_by_user_id) REFERENCES public.users(id);


--
-- Name: purchase_edit_requests purchase_edit_requests_resolved_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_edit_requests
    ADD CONSTRAINT purchase_edit_requests_resolved_by_user_id_fkey FOREIGN KEY (resolved_by_user_id) REFERENCES public.users(id);


--
-- Name: purchase_edit_requests purchase_edit_requests_sibling_purchase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_edit_requests
    ADD CONSTRAINT purchase_edit_requests_sibling_purchase_id_fkey FOREIGN KEY (sibling_purchase_id) REFERENCES public.purchases(id);


--
-- Name: purchases_categories purchases_categories_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases_categories
    ADD CONSTRAINT purchases_categories_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.user_categories(id);


--
-- Name: purchases_categories purchases_categories_purchase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases_categories
    ADD CONSTRAINT purchases_categories_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.purchases(id);


--
-- Name: purchases purchases_financial_entity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_financial_entity_id_fkey FOREIGN KEY (financial_entity_id) REFERENCES public.financial_entities(id);


--
-- Name: purchases_movements purchases_logs_purchase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases_movements
    ADD CONSTRAINT purchases_logs_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.purchases(id);


--
-- Name: purchases purchases_receiver_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_receiver_user_id_fkey FOREIGN KEY (receiver_user_id) REFERENCES public.users(id);


--
-- Name: purchases purchases_shared_from_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_shared_from_id_fkey FOREIGN KEY (shared_from_id) REFERENCES public.purchases(id);


--
-- Name: settlement_session_items settlement_session_items_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_session_items
    ADD CONSTRAINT settlement_session_items_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.settlement_sessions(id) ON DELETE CASCADE;


--
-- Name: financial_entities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.financial_entities ENABLE ROW LEVEL SECURITY;

--
-- Name: financial_entities_movements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.financial_entities_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: purchase_edit_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchase_edit_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: purchases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;

--
-- Name: purchases_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchases_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: purchases_movements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchases_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: settlement_session_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.settlement_session_items ENABLE ROW LEVEL SECURITY;

--
-- Name: settlement_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.settlement_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: settlement_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.settlement_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: user_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict ArL57PoOKyOvu7XZjcEmub3ao5AOPloNwArfKkfOFAiPTbvNj8jW6aHXkhhKA4t

