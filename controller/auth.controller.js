
import { handleError, badRequest } from "../utils/errors.js";

export class AuthController {
    constructor(authService) {
        this.authService = authService;
    }

    register = async (req, res) => {
        try {
            const { name, email, password } = req.body;

            if (!name || !email || !password) {
                return badRequest(res, "Faltan campos");
            }

            await this.authService.register(name, email, password);

            res.json({
                message: "Usuario creado con éxito",
            });

        } catch (err) {
            return handleError(res, err);
        }
    }

    login = async (req, res) => {
        try {
            const { email, password } = req.body;

            if (!email || !password) {
                return badRequest(res, "Faltan campos");
            }

            const response = await this.authService.login(email, password);

            res.json({
                message: "Login exitoso",
                data: response,
            });

        } catch (err) {
            return handleError(res, err);
        }
    }

    firebaseLogin = async (req, res) => {
        try {
            const { idToken, password, discardPassword } = req.body;

            if (typeof idToken !== "string" || !idToken) {
                return badRequest(res, "Token faltante");
            }
            const response = await this.authService.firebaseLogin(idToken, { password, discardPassword });
            res.json({
                message: "Login exitoso",
                data: response,
            });

        } catch (err) {
            return handleError(res, err);
        }
    };
}
