import { handleError, badRequest } from "../utils/errors.js";

const isFilledString = (value) => typeof value === "string" && value.trim().length > 0;

export class AuthController {
    constructor(authService) {
        this.authService = authService;
    }

    register = async (req, res) => {
        try {
            const { name, email, password, language } = req.body;

            if (!name || !email || !password) {
                return badRequest(res, "Faltan campos");
            }

            const result = await this.authService.register(name, email, password, {
                clientIp: req.ip,
                language,
            });

            res.json({
                message: "Usuario creado con éxito",
                data: result,
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

            const response = await this.authService.login(email, password, { clientIp: req.ip });

            res.json({
                message: "Login exitoso",
                data: response,
            });

        } catch (err) {
            return handleError(res, err);
        }
    }

    resendVerification = async (req, res) => {
        try {
            const { email, password, language } = req.body;

            if (!isFilledString(email) || !isFilledString(password)) {
                return badRequest(res, "Faltan campos");
            }

            const result = await this.authService.resendVerification(email, password, {
                clientIp: req.ip,
                language,
            });
            res.json({ data: result });
        } catch (err) {
            return handleError(res, err);
        }
    };

    requestPasswordReset = async (req, res) => {
        try {
            const { email, language } = req.body;

            if (!isFilledString(email)) {
                return badRequest(res, "Falta el email");
            }

            const result = await this.authService.requestPasswordReset(email, { clientIp: req.ip, language });
            res.json({ data: result });
        } catch (err) {
            return handleError(res, err);
        }
    };

    firebaseLogin = async (req, res) => {
        try {
            const { idToken, password, discardPassword } = req.body;

            if (typeof idToken !== "string" || !idToken) {
                return badRequest(res, "Token faltante");
            }
            const response = await this.authService.firebaseLogin(
                idToken,
                { password, discardPassword },
                { clientIp: req.ip },
            );
            res.json({
                message: "Login exitoso",
                data: response,
            });

        } catch (err) {
            return handleError(res, err);
        }
    };
}
