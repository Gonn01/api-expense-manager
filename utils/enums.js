export const MovementType = Object.freeze({
    CREATION: 'CREATION',
    PAYMENT: 'PAYMENT',
    PENDING_PAYMENT: 'PENDING_PAYMENT',
    PAYMENT_REJECTED: 'PAYMENT_REJECTED',
    PAYMENT_WITHDRAWN: 'PAYMENT_WITHDRAWN',
    REFUND: 'REFUND',
    DELETE: 'DELETE',
    RESTORE: 'RESTORE',
    EDITED: 'EDITED',
    POSTPONED: 'POSTPONED',
    UNPOSTPONED: 'UNPOSTPONED',
    LINK: 'LINK',
    UNLINK: 'UNLINK',
    PURCHASE_CREATED: 'PURCHASE_CREATED',
    PAYMENT_REQUESTED: 'PAYMENT_REQUESTED',
    PAYMENT_REVERTED: 'PAYMENT_REVERTED',
    REVERSAL_REQUESTED: 'REVERSAL_REQUESTED',
    REVERSAL_CANCELLED: 'REVERSAL_CANCELLED',
    REVERSAL_REJECTED: 'REVERSAL_REJECTED',
    SHARED_APPROVED: 'SHARED_APPROVED',
    SHARED_REJECTED: 'SHARED_REJECTED',
    SHARED_RETRIED: 'SHARED_RETRIED',
    EDIT_REQUESTED: 'EDIT_REQUESTED',
    EDIT_APPROVED: 'EDIT_APPROVED',
    EDIT_REJECTED: 'EDIT_REJECTED',
    EDIT_CANCELLED: 'EDIT_CANCELLED',
});

export const Currency = Object.freeze({
    ARS: 'ARS',
    USD: 'USD',
    EUR: 'EUR',
    BRL: 'BRL',
    CLP: 'CLP',
    UYU: 'UYU',
    AUD: 'AUD',
    AWG: 'AWG',
    BOB: 'BOB',
    CAD: 'CAD',
    CHF: 'CHF',
    CNH: 'CNH',
    CNY: 'CNY',
    COP: 'COP',
    CZK: 'CZK',
    DKK: 'DKK',
    GBP: 'GBP',
    HKD: 'HKD',
    ILS: 'ILS',
    INR: 'INR',
    JPY: 'JPY',
    MXN: 'MXN',
    NIO: 'NIO',
    NOK: 'NOK',
    NZD: 'NZD',
    PEN: 'PEN',
    PYG: 'PYG',
    RSD: 'RSD',
    RUB: 'RUB',
    SEK: 'SEK',
    SGD: 'SGD',
    TRY: 'TRY',
    VES: 'VES',
    VND: 'VND',
    XDR: 'XDR',
    ZAR: 'ZAR',
});

export const normalizeCurrency = (value) => {
    const code = String(value).toUpperCase();
    return Object.values(Currency).includes(code) ? code : null;
};

export const ExpenseType = Object.freeze({
    EGRESO: 'EGRESO',
    INGRESO: 'INGRESO',
});

export const oppositeExpenseType = (type) =>
    String(type).toUpperCase() === ExpenseType.INGRESO ? ExpenseType.EGRESO : ExpenseType.INGRESO;

export const ExpenseStatus = Object.freeze({
    ACTIVE: 'ACTIVE',
    PENDING_APPROVAL: 'PENDING_APPROVAL',
    REJECTED: 'REJECTED',
});

export const PusherEvent = Object.freeze({
    COMPARTIDO_NUEVO: 'compartido.nuevo',
    COMPARTIDO_APROBADO: 'compartido.aprobado',
    COMPARTIDO_RECHAZADO: 'compartido.rechazado',
    COMPARTIDO_DESCARTADO: 'compartido.descartado',
    COMPARTIDO_DESVINCULADO: 'compartido.desvinculado',
    PAGO_PENDIENTE: 'pago.pendiente',
    PAGO_CONFIRMADO: 'pago.confirmado',
    PAGO_RECHAZADO: 'pago.rechazado',
    PAGO_RETIRADO: 'pago.retirado',
    PAGO_REVERSION_SOLICITADA: 'pago.reversion_solicitada',
    PAGO_REVERSION_CANCELADA: 'pago.reversion_cancelada',
    PAGO_REVERSION_ACEPTADA: 'pago.reversion_aceptada',
    PAGO_REVERSION_RECHAZADA: 'pago.reversion_rechazada',
    EDICION_SOLICITADA: 'edicion.solicitada',
    EDICION_APROBADA: 'edicion.aprobada',
    EDICION_RECHAZADA: 'edicion.rechazada',
    EDICION_CANCELADA: 'edicion.cancelada',
    ENTIDAD_VINCULADA: 'entidad.vinculada',
    ENTIDAD_DESVINCULADA: 'entidad.desvinculada',
    GASTO_POSTERGADO: 'gasto.postergado',
    GASTO_POSTERGACION_QUITADA: 'gasto.postergacion_quitada',
});

export const NOTIFICACION_NUEVA_EVENT = 'notificacion.nueva';
