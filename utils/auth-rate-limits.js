const FIFTEEN_MINUTES = 15 * 60;
const ONE_HOUR = 60 * 60;

export const AuthRateLimits = Object.freeze({
    login: (email, clientIp) => [
        { key: `login:${email}:${clientIp}`, limit: 5, windowSeconds: FIFTEEN_MINUTES },
        { key: `login-ip:${clientIp}`, limit: 30, windowSeconds: FIFTEEN_MINUTES },
    ],
    register: (clientIp) => [{ key: `register-ip:${clientIp}`, limit: 10, windowSeconds: ONE_HOUR }],
    googleLogin: (clientIp) => [{ key: `google-ip:${clientIp}`, limit: 30, windowSeconds: FIFTEEN_MINUTES }],
    password: (userId) => [{ key: `password:${userId}`, limit: 5, windowSeconds: FIFTEEN_MINUTES }],
});
