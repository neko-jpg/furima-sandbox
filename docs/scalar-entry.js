import { createApiReference } from '@scalar/api-reference';
import '@scalar/api-reference/style.css';

const mount = document.querySelector('#scalar-api-reference');

if (mount) {
  createApiReference(mount, {
    url: './api/openapi.yaml',
    theme: 'moon',
    darkMode: true,
    withDefaultFonts: false,
    hideTestRequestButton: true,
    showDeveloperTools: 'never',
    agent: { disabled: true },
  });
}
