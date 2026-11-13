/**
 * Default catalogs for Uruguay (spec, section 7.3). The editable ones (property types, amenities, lead
 * sources) are copied into each brokerage's policies; departments and currencies are fixed lists.
 * Mirrored in frontend/src/lib/catalogs.ts (labels live in the i18n dictionaries).
 */

/** Property types shown by default in Uruguay. */
export const PROPERTY_TYPES_UY = [
    'APARTAMENTO', 'CASA', 'TERRENO', 'CAMPO_CHACRA', 'LOCAL_COMERCIAL', 'OFICINA',
    'GALPON', 'HOTEL', 'COCHERA', 'EDIFICIO', 'OTRO',
] as const;

/** Types from the original (New York) catalog: still valid values, hidden unless a brokerage turns them on. */
export const PROPERTY_TYPES_LEGACY = ['CONDO', 'COOP', 'TOWNHOUSE', 'SINGLE_FAMILY', 'MULTI_FAMILY', 'COMMERCIAL', 'LAND'] as const;

export const ALL_PROPERTY_TYPES = [...PROPERTY_TYPES_UY, ...PROPERTY_TYPES_LEGACY] as const;
export type PropertyTypeCode = typeof ALL_PROPERTY_TYPES[number];

/** The 19 departments, used for the address "state". */
export const DEPARTMENTS_UY = [
    'Artigas', 'Canelones', 'Cerro Largo', 'Colonia', 'Durazno', 'Flores', 'Florida', 'Lavalleja', 'Maldonado',
    'Montevideo', 'Paysandú', 'Río Negro', 'Rivera', 'Rocha', 'Salto', 'San José', 'Soriano', 'Tacuarembó', 'Treinta y Tres',
] as const;

export const AMENITIES_UY = [
    'patio', 'parrillero', 'barbacoa', 'jardin', 'terraza', 'balcon', 'piscina', 'ascensor', 'portero', 'calefaccion',
    'aire_acondicionado', 'amoblado', 'apto_mascotas', 'vista_al_mar', 'seguridad', 'gimnasio', 'lavadero', 'deposito',
] as const;

/** USD for sales, UYU usual for rentals; UI (unidades indexadas) and UR (unidades reajustables) for contracts. */
export const CURRENCIES = ['USD', 'UYU', 'UI', 'UR'] as const;

/** Default lead sources in Uruguay (spec, section 5.4). The New York ones stay valid if a brokerage adds them. */
export const LEAD_SOURCES_UY = [
    'Sitio web', 'WhatsApp', 'InfoCasas', 'Mercado Libre', 'Gallito', 'Instagram', 'Facebook', 'Cartel', 'Referido', 'Oficina',
];

/** Defaults for a new organization. */
export const ORG_DEFAULTS = { country: 'UY', timezone: 'America/Montevideo', currency: 'USD', language: 'es' } as const;
