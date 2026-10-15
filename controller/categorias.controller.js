import { handleError, badRequest } from "../utils/errors.js";
import { HttpStatus } from "../utils/http_status.js";

export class CategoriasController {
    constructor(categoriasService) {
        this.categoriasService = categoriasService;
    }

    listar = async (req, res) => {
        try {
            const { userId } = req.session;
            const data = await this.categoriasService.listar(userId);
            res.json({ message: "Listado de categorías", data });
        } catch (err) {
            return handleError(res, err);
        }
    };

    crear = async (req, res) => {
        try {
            const { name, color } = req.body;
            const { userId } = req.session;

            if (!name) return badRequest(res, "Falta el campo 'name'");

            const data = await this.categoriasService.crear(name, color, userId);
            res.status(HttpStatus.CREATED).json({ message: "Categoría creada con éxito", data });
        } catch (err) {
            return handleError(res, err);
        }
    };
}
