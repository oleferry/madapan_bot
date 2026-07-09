interface CatalogProduct {
    cod: string;
    name: string;
    sku: string;
    holdedId: string | null;
    iva: number;
    special24h?: boolean;
    prices: Record<string, number>;
}
interface CatalogClient {
    cod: string;
    name: string;
    discount: number;
    tarifa: string;
}
export declare function getClientByNif(nif: string): CatalogClient | null;
export declare function getAllProducts(): CatalogProduct[];
export declare function getAllClients(): Array<{
    nif: string;
    name: string;
}>;
export declare function getProductByCod(cod: string): CatalogProduct | null;
export declare function getProductBySku(sku: string): CatalogProduct | null;
export declare function getClientPrice(product: CatalogProduct, tarifa: string, discountPct: number): number;
export declare function getTarifaPrice(product: CatalogProduct, tarifa: string): number;
export declare function getAvailableProducts(): CatalogProduct[];
export {};
//# sourceMappingURL=catalogService.d.ts.map