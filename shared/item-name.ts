/** Khoá so tên món: "Trà đá " và "TRÀ ĐÁ" là một món; "Bò" và "Bơ" là hai món. */
export function itemNameKey(name: string): string {
  return name.trim().toLocaleLowerCase('vi')
}
