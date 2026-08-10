import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

const browserGlobalsDisabled = Object.fromEntries(
  Object.keys(globals.browser).map((name) => [name, 'off']),
)

export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'coverage', 'node_modules', 'worker/.wrangler'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['worker/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...browserGlobalsDisabled,
        ...globals.serviceworker,
      },
    },
  },
  {
    // Chỉ src/db được chạm thẳng vào bảng. Ghi `payments` ngoài repository là làm lệch `orders.paidAmount`.
    // Test được miễn: dọn bảng giữa các ca là việc của hạ tầng test, không phải luồng nghiệp vụ.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/db/**', 'src/**/__tests__/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/db/db', '**/db/db'],
              message: 'Dùng repository trong @/db/repositories thay vì ghi thẳng bảng.',
            },
          ],
        },
      ],
    },
  },
  {
    // domain/ phải là hàm thuần: không React, không Dexie (bất biến #5 trong plan)
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'src/domain phải là hàm thuần — không import React.' },
            { name: 'dexie', message: 'src/domain phải là hàm thuần — không import Dexie.' },
          ],
          patterns: [
            { group: ['@/db/*', '../db/*', '../../db/*'], message: 'src/domain không được phụ thuộc vào lớp DB.' },
          ],
        },
      ],
    },
  },
)
