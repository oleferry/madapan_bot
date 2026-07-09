export interface PizzaItem {
    id: string;
    name: string;
    ingredientes: string[];
}
export interface PostreItem {
    id: string;
    name: string;
}
export interface PizzaMenu {
    diasDisponibles: string[];
    horaInicio: string;
    horaFin: string;
    pizzas: PizzaItem[];
    postres: PostreItem[];
    precioIndividual: number;
    precioMenu: number;
    menuIncluye: string;
}
export declare function getMenu(): PizzaMenu;
export declare function getPizzaById(id: string): PizzaItem | null;
export declare function getPostreById(id: string): PostreItem | null;
export declare function setWeekendStock(total: number): void;
export declare function getRemainingStock(): number | null;
export declare function consumeStock(units: number): boolean;
export interface PizzaOrderEntry {
    timestamp: string;
    telegramId: string;
    nombre: string;
    telefono: string;
    email: string;
    marketingConsent: boolean;
    tipo: 'individual' | 'menu';
    pizzaId: string;
    pizzaName: string;
    postres: string[];
    cantidad: number;
    diaRecogida: string;
    horaRecogida: string;
    precioTotal: number;
    weekOf: string;
}
export declare function logPizzaOrder(entry: Omit<PizzaOrderEntry, 'weekOf'>): void;
export declare function buildPizzaOrdersSummary(): string;
//# sourceMappingURL=pizzaService.d.ts.map