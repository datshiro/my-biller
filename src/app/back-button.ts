import { TAB_PATHS } from './tabs'

export type BackAction = 'navigate-back' | 'go-home' | 'minimize'

/**
 * Phím Back của APK. Ở tab gốc thì thu app như Back mặc định của Android 12+ (mở lại vẫn đúng tab);
 * màn mở thẳng không có bước trước (`historyIdx` 0) thì về màn Bán thay vì đứng im.
 */
export function decideBack({ pathname, historyIdx }: { pathname: string; historyIdx: number }): BackAction {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname
  if (TAB_PATHS.includes(path)) return 'minimize'
  return historyIdx > 0 ? 'navigate-back' : 'go-home'
}
