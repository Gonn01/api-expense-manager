import jwt from 'jsonwebtoken';
import { logRed } from '../utils/logs_custom.js';
import { JWT_SECRET } from '../config/env.js';
import { HttpStatus } from '../utils/http_status.js';

export function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    logRed('Token no proporcionado');
    return res.status(HttpStatus.UNAUTHORIZED).json({ message: 'Token no proporcionado' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      logRed('Token inválido', token);
      // 401 (no 403): un token vencido o inválido es "no autenticado", y es la
      // señal que usan los clientes para cerrar la sesión y mandar al login.
      // 403 queda para "autenticado pero sin permiso" (NO_AUTORIZADO).
      return res.status(HttpStatus.UNAUTHORIZED).json({ message: 'Token inválido o vencido' });
    }

    req.session = decoded;

    next();
  });
}
