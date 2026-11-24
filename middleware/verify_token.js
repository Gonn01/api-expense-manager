import jwt from 'jsonwebtoken';
import { logRed } from '../utils/logs_custom.js';
import { JWT_SECRET } from '../config/env.js';
import { HttpStatus } from '../utils/http_status.js';
import { handleError } from '../utils/errors.js';
import { UserRepository } from '../repositories/user.repository.js';

const rejectToken = (res, message) => res.status(HttpStatus.UNAUTHORIZED).json({ message });

export function createVerifyToken(userRepository) {
  return async function verifyToken(req, res, next) {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      logRed('Token no proporcionado');
      return rejectToken(res, 'Token no proporcionado');
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    } catch (err) {
      logRed(`Token inválido: ${err.name}`);
      return rejectToken(res, 'Token inválido o vencido');
    }

    try {
      const [user] = await userRepository.getTokenVersion(decoded.userId);
      if (!user || user.token_version !== decoded.tokenVersion) {
        logRed('Token revocado');
        return rejectToken(res, 'Token inválido o vencido');
      }
    } catch (err) {
      return handleError(res, err);
    }

    req.session = decoded;
    return next();
  };
}

export const verifyToken = createVerifyToken(new UserRepository());
