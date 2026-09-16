import express from "express";
import cors from "cors";
import routesIndex from "./routes/index.js";
import { logBlue } from "./utils/logs_custom.js";
import { errorMiddleware } from "./utils/errors.js";

const app = express();
app.use(cors());
app.use(express.json());

const port = process.env.PORT || 3000;

app.use("/api", routesIndex);

// Red de seguridad: si un handler async lanza sin capturar, traduce el error
// a una respuesta HTTP en vez de tumbar el request.
app.use(errorMiddleware);

app.listen(port, () => {
    logBlue(`Servidor corriendo en http://localhost:${port}`);
});