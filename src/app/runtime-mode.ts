declare const __MY_BILLER_RECOVERY_MODE__: boolean

/** Build-time constant; recovery không thể được bật/tắt bằng query string hoặc localStorage. */
export const RECOVERY_MODE = __MY_BILLER_RECOVERY_MODE__
