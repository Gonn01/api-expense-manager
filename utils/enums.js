export const MovementType = Object.freeze({
    CREATION:         'CREATION',
    PAYMENT:          'PAYMENT',
    PENDING_PAYMENT:  'PENDING_PAYMENT',
    REFUND:           'REFUND',
    DELETE:           'DELETE',
    RESTORE:          'RESTORE',
    EDITED:           'EDITED',
    POSTPONED:        'POSTPONED',
    UNPOSTPONED:      'UNPOSTPONED',
    // Historial de entidades financieras
    LINK:             'LINK',
    UNLINK:           'UNLINK',
    PURCHASE_CREATED: 'PURCHASE_CREATED',
});

export const Currency = Object.freeze({
    ARS: 'ARS',
    USD: 'USD',
    EUR: 'EUR',
    BRL: 'BRL',
    CLP: 'CLP',
    UYU: 'UYU',
});

export const ExpenseType = Object.freeze({
    EGRESO:  'EGRESO',
    INGRESO: 'INGRESO',
});

export const ExpenseStatus = Object.freeze({
    ACTIVE:            'ACTIVE',
    PENDING_APPROVAL:  'PENDING_APPROVAL',
    REJECTED:          'REJECTED',
});
