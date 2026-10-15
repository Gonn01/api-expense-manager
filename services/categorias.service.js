export class CategoriasService {
    constructor({ categoriasRepository }) {
        this.categoriasRepository = categoriasRepository;
    }

    async listar(userId) {
        return await this.categoriasRepository.listar(userId);
    }

    async crear(name, color, userId) {
        const [row] = await this.categoriasRepository.create(name, color, userId);
        return row;
    }
}
