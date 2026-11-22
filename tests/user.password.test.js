import { describe, it, expect, vi, beforeEach } from "vitest";
import bcrypt from "bcrypt";
import { UserController } from "../controller/user.controller.js";
import { UserService } from "../services/user.service.js";

function makeRes() {
    const res = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
}

describe("contraseña del usuario", () => {
    let userRepository;
    let service;

    beforeEach(() => {
        userRepository = {
            getPasswordHash: vi.fn(),
            updatePassword: vi.fn().mockResolvedValue([{ id: 1 }]),
        };
        service = new UserService({ userRepository });
    });

    it("informa si la cuenta tiene contraseña sin exponer el hash", async () => {
        userRepository.getPasswordHash.mockResolvedValue([{ password: "hash" }]);

        await expect(service.getPasswordStatus(1)).resolves.toEqual({ has_password: true });
    });

    it("una cuenta de Google define su contraseña sin la actual", async () => {
        userRepository.getPasswordHash.mockResolvedValue([{ password: null }]);

        await expect(service.updatePassword(1, undefined, "nueva123")).resolves.toEqual({ has_password: true });

        const savedHash = userRepository.updatePassword.mock.calls[0][1];
        expect(await bcrypt.compare("nueva123", savedHash)).toBe(true);
    });

    it("exige la contraseña actual si ya tiene una", async () => {
        userRepository.getPasswordHash.mockResolvedValue([{ password: await bcrypt.hash("actual", 4) }]);

        await expect(service.updatePassword(1, undefined, "nueva123")).rejects.toMatchObject({ code: "CONTRASENA_INCORRECTA" });
        await expect(service.updatePassword(1, "mal", "nueva123")).rejects.toMatchObject({ code: "CONTRASENA_INCORRECTA" });
        expect(userRepository.updatePassword).not.toHaveBeenCalled();
    });

    it("cambia la contraseña con la actual correcta", async () => {
        userRepository.getPasswordHash.mockResolvedValue([{ password: await bcrypt.hash("actual", 4) }]);

        await service.updatePassword(1, "actual", "nueva123");

        expect(userRepository.updatePassword).toHaveBeenCalledTimes(1);
    });

    it("el controller rechaza una contraseña corta", async () => {
        const userService = { updatePassword: vi.fn() };
        const controller = new UserController(userService);
        const res = makeRes();

        await controller.updatePassword({ body: { new_password: "123" }, session: { userId: 1 } }, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(userService.updatePassword).not.toHaveBeenCalled();
    });

    it("el controller toma el usuario de la sesión", async () => {
        const userService = { updatePassword: vi.fn().mockResolvedValue({ has_password: true }) };
        const controller = new UserController(userService);
        const res = makeRes();

        await controller.updatePassword(
            { body: { user_id: 99, current_password: "actual", new_password: "nueva123" }, session: { userId: 1 } },
            res,
        );

        expect(userService.updatePassword).toHaveBeenCalledWith(1, "actual", "nueva123");
    });
});
