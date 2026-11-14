export const MovementType = Object.freeze({
    CREATION:         'CREATION',
    PAYMENT:          'PAYMENT',
    PENDING_PAYMENT:  'PENDING_PAYMENT',
    PAYMENT_REJECTED: 'PAYMENT_REJECTED',
    PAYMENT_WITHDRAWN: 'PAYMENT_WITHDRAWN',
    REFUND:           'REFUND',
    DELETE:           'DELETE',
    RESTORE:          'RESTORE',
    EDITED:           'EDITED',
    POSTPONED:        'POSTPONED',
    UNPOSTPONED:      'UNPOSTPONED',
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

export const PusherEvent = Object.freeze({
    COMPARTIDO_NUEVO:          'compartido.nuevo',
    COMPARTIDO_APROBADO:       'compartido.aprobado',
    COMPARTIDO_RECHAZADO:      'compartido.rechazado',
    PAGO_PENDIENTE:            'pago.pendiente',
    PAGO_CONFIRMADO:           'pago.confirmado',
    PAGO_RECHAZADO:            'pago.rechazado',
    PAGO_RETIRADO:             'pago.retirado',
    PAGO_REVERSION_SOLICITADA: 'pago.reversion_solicitada',
    PAGO_REVERSION_CANCELADA:  'pago.reversion_cancelada',
    PAGO_REVERSION_ACEPTADA:   'pago.reversion_aceptada',
    PAGO_REVERSION_RECHAZADA:  'pago.reversion_rechazada',
});
