import { handleError, badRequest } from "../utils/errors.js";
import { HttpStatus } from "../utils/http_status.js";

export class SettlementController {
    constructor(settlementService) {
        this.settlementService = settlementService;
    }

    getSession = async (req, res) => {
        try {
            const { userId } = req.session;
            const data = await this.settlementService.getSession(userId);
            res.json({ message: "Sesión de cuentas", data });
        } catch (err) {
            return handleError(res, err);
        }
    };

    startSession = async (req, res) => {
        try {
            const { userId } = req.session;
            const data = await this.settlementService.startSession(userId);
            res.status(data.alreadyOpen ? HttpStatus.OK : HttpStatus.CREATED).json({
                message: data.alreadyOpen ? "Ya había una sesión abierta" : "Sesión de cuentas iniciada",
                data,
            });
        } catch (err) {
            return handleError(res, err);
        }
    };

    setItems = async (req, res) => {
        try {
            const { userId } = req.session;
            const { purchase_id, purchase_ids, checked } = req.body;

            if (typeof checked !== "boolean") {
                return badRequest(res, "Debe enviar 'checked' (boolean)");
            }

            let data;
            if (Array.isArray(purchase_ids)) {
                data = await this.settlementService.setItemsBulk(userId, purchase_ids, checked);
            } else if (purchase_id !== undefined && purchase_id !== null) {
                data = await this.settlementService.setItem(userId, Number(purchase_id), checked);
            } else {
                return badRequest(res, "Debe enviar 'purchase_id' o 'purchase_ids'");
            }

            res.json({ message: "Sesión actualizada", data });
        } catch (err) {
            return handleError(res, err);
        }
    };

    finishSession = async (req, res) => {
        try {
            const { userId } = req.session;
            const snapshot = await this.settlementService.finishSession(userId);
            res.json({ message: "Cuentas cerradas", data: snapshot });
        } catch (err) {
            return handleError(res, err);
        }
    };

    discardSession = async (req, res) => {
        try {
            const { userId } = req.session;
            const data = await this.settlementService.discardSession(userId);
            res.json({ message: "Sesión descartada", data });
        } catch (err) {
            return handleError(res, err);
        }
    };

    listSnapshots = async (req, res) => {
        try {
            const { userId } = req.session;
            const data = await this.settlementService.listSnapshots(userId);
            res.json({ message: "Snapshots de cuentas", data });
        } catch (err) {
            return handleError(res, err);
        }
    };

    getSnapshot = async (req, res) => {
        try {
            const { userId } = req.session;
            const { id } = req.params;
            const data = await this.settlementService.getSnapshot(userId, Number(id));
            res.json({ message: "Snapshot de cuentas", data });
        } catch (err) {
            return handleError(res, err);
        }
    };
}
