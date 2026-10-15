import { handleError, badRequest } from "../utils/errors.js";
import { HttpStatus } from "../utils/http_status.js";

export class EntidadesFinancierasController {
    constructor(entidadesFinancierasService) {
        this.entidadesFinancierasService = entidadesFinancierasService;
    }

    listar = async (req, res) => {
        try {
            const { userId } = req.session;

            const response = await this.entidadesFinancierasService.listar(userId);

            res.json({
                message: "Listado de entidades financieras",
                data: response
            });
        } catch (err) {
            return handleError(res, err);
        }
    }

    listarEliminadas = async (req, res) => {
        try {
            const { userId } = req.session;

            const response = await this.entidadesFinancierasService.listarEliminadas(userId);

            res.json({
                message: "Listado de entidades financieras eliminadas",
                data: response
            });
        } catch (err) {
            logRed(err);
            res.status(500).json({ error: "Error en el servidor" });
        }
    }

    restaurar = async (req, res) => {
        try {
            const { id } = req.params;
            const { userId } = req.session;

            const response = await this.entidadesFinancierasService.restaurar(id, userId);

            res.json({
                message: "Entidad financiera restaurada con éxito",
                data: response
            });
        } catch (err) {
            logRed(err);
            res.status(500).json({ error: "Error en el servidor" });
        }
    }

    obtenerPorId = async (req, res) => {
        try {
            const { id } = req.params;
            const { userId } = req.session;

            const response = await this.entidadesFinancierasService.obtenerPorId(id, userId);

            res.json({
                message: "Entidad financiera obtenida con éxito",
                data: response
            });
        } catch (err) {
            return handleError(res, err);
        }
    };

    crear = async (req, res) => {
        try {
            const { name } = req.body;
            const { userId } = req.session;

            if (!name) {
                return badRequest(res, "Falta el campo 'name'");
            }

            const response = await this.entidadesFinancierasService.crear(name, userId);

            res.status(HttpStatus.CREATED).json({
                message: "Entidad financiera creada con éxito",
                data: response
            });
        } catch (err) {
            return handleError(res, err);
        }
    }

    actualizar = async (req, res) => {
        try {
            const { id } = req.params;
            const { name } = req.body;
            const { userId } = req.session;

            const response = await this.entidadesFinancierasService.actualizar(id, name, userId);
            const movements = await this.entidadesFinancierasService.obtenerMovements(id);
            response.movements = movements;
            res.json({
                message: "Entidad financiera actualizada con éxito",
                data: response
            });
        } catch (err) {
            return handleError(res, err);
        }
    }

    favorito = async (req, res) => {
        try {
            const { id } = req.params;
            const { userId } = req.session;
            const favorite = req.body?.favorite ?? true;

            const response = await this.entidadesFinancierasService.marcarFavorito(id, userId, favorite);

            res.json({
                message: "Entidad financiera actualizada con éxito",
                data: response
            });
        } catch (err) {
            return handleError(res, err);
        }
    }

    eliminar = async (req, res) => {
        try {
            const { id } = req.params;
            const { userId } = req.session;

            const response = await this.entidadesFinancierasService.eliminar(id, userId);

            res.json({
                message: "Entidad financiera eliminada con éxito",
                data: response
            });
        } catch (err) {
            return handleError(res, err);
        }
    }

    vincularUsuario = async (req, res) => {
        try {
            const { id } = req.params;
            const { email } = req.body;
            const { userId } = req.session;

            if (!email) {
                return badRequest(res, "Falta el campo 'email'");
            }

            const response = await this.entidadesFinancierasService.vincularUsuario(id, userId, email);

            res.json({
                message: "Usuario vinculado con éxito",
                data: response
            });
        } catch (err) {
            return handleError(res, err);
        }
    }

    desvincularUsuario = async (req, res) => {
        try {
            const { id } = req.params;
            const { userId } = req.session;

            const response = await this.entidadesFinancierasService.desvincularUsuario(id, userId);

            res.json({
                message: "Usuario desvinculado con éxito",
                data: response
            });
        } catch (err) {
            return handleError(res, err);
        }
    }
}
