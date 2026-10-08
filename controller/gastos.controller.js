import { handleError, badRequest } from "../utils/errors.js";
import { HttpStatus } from "../utils/http_status.js";

export class GastosController {

    constructor(gastosService) {
        this.gastosService = gastosService;
    }

    crear = async (req, res) => {
        try {
            const {
                financial_entity_id,
                name,
                amount,
                number_of_quotas,
                currency_type,
                fixed_expense,
                image_url,
                type,
                payed_quotas,
                category_ids,
                payment_entity_id,
                postponed,
            } = req.body;
            const { userId } = req.session;

            if (!financial_entity_id || !name || !amount || !currency_type) {
                return badRequest(res, "Faltan campos obligatorios");
            }

            const inserted = await this.gastosService.crearGasto(
                financial_entity_id,
                name,
                amount,
                number_of_quotas,
                currency_type,
                fixed_expense,
                image_url,
                type,
                userId,
                payed_quotas,
                category_ids,
                payment_entity_id,
                postponed
            );
            res.status(HttpStatus.CREATED).json({
                message: "Gasto creado con éxito",
                data: inserted[0],
            });
        } catch (err) {
            return handleError(res, err);
        }
    };

    getById = async (req, res) => {
        try {
            const { id } = req.params;

            const response = await this.gastosService.getById(id);

            res.json({
                message: "Gasto encontrado",
                data: response
            });
        } catch (err) {
            return handleError(res, err);
        }
    }

    update = async (req, res) => {
        try {
            const { id } = req.params;
            const { name, amount, image_url, fixed_expense, type, category_ids, payed_quotas, apply_to_linked } = req.body;

            const response = await this.gastosService.update(id, name, amount, image_url, fixed_expense, type, category_ids, payed_quotas, apply_to_linked);

            res.json({
                message: "Gasto actualizado",
                data: response
            });
        } catch (err) {
            return handleError(res, err);
        }
    }

    delete = async (req, res) => {
        try {
            const { id } = req.params;
            const deleteLinked = req.body?.delete_linked ?? req.query?.delete_linked;
            const shouldDeleteLinked = deleteLinked === true || deleteLinked === "true";

            await this.gastosService.delete(id, shouldDeleteLinked);

            res.json({
                message: "Gasto eliminado correctamente",
                data: id
            });
        } catch (err) {
            return handleError(res, err);
        }
    }

    restaurar = async (req, res) => {
        try {
            const { id } = req.params;
            const { userId } = req.session;

            const data = await this.gastosService.restaurar(id, userId);

            res.json({
                message: "Gasto restaurado correctamente",
                data
            });
        } catch (err) {
            return handleError(res, err);
        }
    }

    postergar = async (req, res) => {
        try {
            const { id } = req.params;
            const { userId } = req.session;
            const postponed = req.body?.postponed ?? true;

            const data = await this.gastosService.postergarGasto(id, userId, postponed);
            res.json({ message: "Gasto actualizado", data });
        } catch (err) {
            return handleError(res, err);
        }
    }

    favorito = async (req, res) => {
        try {
            const { id } = req.params;
            const { userId } = req.session;
            const favorite = req.body?.favorite ?? true;

            const data = await this.gastosService.marcarFavorito(id, userId, favorite);
            res.json({ message: "Gasto actualizado", data });
        } catch (err) {
            return handleError(res, err);
        }
    }

    settleQuota = async (req, res) => {
        try {
            const { id } = req.params;
            const { userId } = req.session;
            const direct = req.body?.direct === true || req.body?.direct === "true";

            const updated = await this.gastosService.settleQuota(id, userId, { direct });

            res.json({
                message: "Cuota pagada con éxito",
                data: updated[0]
            });
        } catch (err) {
            return handleError(res, err);
        }
    }

    refundCuota = async (req, res) => {
        try {
            const { id } = req.params;

            const updated = await this.gastosService.refundCuota(id);

            res.json({
                message: "Cuota revertida con éxito",
                data: updated[0]
            });
        } catch (err) {
            return handleError(res, err);
        }
    }

    actualizarCategorias = async (req, res) => {
        try {
            const { id } = req.params;
            const { category_ids } = req.body;

            if (!Array.isArray(category_ids)) {
                return badRequest(res, "Debe enviar 'category_ids' como array");
            }

            const data = await this.gastosService.actualizarCategorias(id, category_ids);
            res.json({ message: "Categorías actualizadas con éxito", data });
        } catch (err) {
            return handleError(res, err);
        }
    }

    settleQuotasLote = async (req, res) => {
        try {
            const { purchase_ids } = req.body;
            const { userId } = req.session;

            if (!Array.isArray(purchase_ids) || purchase_ids.length === 0) {
                return badRequest(res, "Debe enviar 'purchase_ids' como array no vacío");
            }

            const { updated, failed } = await this.gastosService.settleQuotasLote(purchase_ids, userId);

            res.json({
                message: "Lote procesado",
                data: {
                    updated,
                    failed
                }
            });
        } catch (err) {
            return handleError(res, err);
        }
    }

}
