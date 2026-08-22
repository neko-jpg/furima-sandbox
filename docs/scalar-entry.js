import { createApiReference } from '@scalar/api-reference';
import '@scalar/api-reference/style.css';

const neoBrutalistCss = String.raw`
  :where(.scalar-app) {
    --scalar-font: "Arial", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;
    --scalar-font-code: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    --scalar-background-1: #fffdf4 !important;
    --scalar-background-2: #f4eedc !important;
    --scalar-background-3: #e7ddc5 !important;
    --scalar-background-4: #d8cdb4 !important;
    --scalar-color-1: #171717 !important;
    --scalar-color-2: #4a4740 !important;
    --scalar-color-3: #6f6a60 !important;
    --scalar-color-accent: #171717 !important;
    --scalar-link-color: #171717 !important;
    --scalar-link-color-hover: #171717 !important;
    --scalar-border-color: #171717 !important;
    --scalar-border-width: 2px !important;
    --scalar-radius: 0px !important;
    --scalar-radius-md: 0px !important;
    --scalar-radius-lg: 0px !important;
    --scalar-radius-xl: 0px !important;
    --scalar-radius-2xl: 0px !important;
    --scalar-shadow-1: 4px 4px 0 #171717 !important;
    --scalar-shadow-2: 7px 7px 0 #171717 !important;
    --scalar-sidebar-background-1: #fffdf4 !important;
    --scalar-sidebar-item-hover-background: #a7e8ff !important;
    --scalar-sidebar-item-active-background: #c9f45a !important;
    --scalar-sidebar-search-background: #fffdf4 !important;
    --scalar-button-1: #171717 !important;
    --scalar-button-1-hover: #37342d !important;
    --scalar-button-1-color: #fffdf4 !important;
    --scalar-color-green: #247a4c !important;
    --scalar-color-red: #cf382f !important;
    --scalar-color-yellow: #a46a00 !important;
    --scalar-color-blue: #126a87 !important;
    --scalar-color-orange: #b74b18 !important;
    --scalar-color-purple: #6d3aa9 !important;
  }

  :where(.scalar-app) .scalar-card,
  :where(.scalar-app) .scalar-card-header,
  :where(.scalar-app) .scalar-card-content,
  :where(.scalar-app) button,
  :where(.scalar-app) input,
  :where(.scalar-app) select,
  :where(.scalar-app) textarea {
    border-radius: 0 !important;
  }

  :where(.scalar-app) .scalar-card {
    border: 2px solid #171717 !important;
    box-shadow: 4px 4px 0 #171717;
  }

  :where(.scalar-app) button {
    border: 2px solid #171717 !important;
    box-shadow: 3px 3px 0 #171717;
    font-weight: 800;
  }

  :where(.scalar-app) button:hover,
  :where(.scalar-app) button:focus-visible {
    transform: translate(-1px, -1px);
    box-shadow: 4px 4px 0 #171717;
  }

  :where(.scalar-app) button:active {
    transform: translate(2px, 2px);
    box-shadow: 1px 1px 0 #171717;
  }

  :where(.scalar-app) input,
  :where(.scalar-app) select,
  :where(.scalar-app) textarea {
    border: 2px solid #171717 !important;
    box-shadow: 3px 3px 0 #171717;
  }

  :where(.scalar-app) input:focus-visible,
  :where(.scalar-app) select:focus-visible,
  :where(.scalar-app) textarea:focus-visible,
  :where(.scalar-app) button:focus-visible,
  :where(.scalar-app) a:focus-visible {
    outline: 3px solid #f08a70;
    outline-offset: 3px;
  }

  :where(.scalar-app) pre,
  :where(.scalar-app) code {
    border-radius: 0 !important;
  }

  :where(.scalar-app) pre {
    border: 2px solid #171717;
    box-shadow: 4px 4px 0 #171717;
  }

  :where(.scalar-app) .t-doc__sidebar,
  :where(.scalar-app) .scalar-sidebar {
    border-right: 2px solid #171717;
  }

  @media (max-width: 720px) {
    :where(.scalar-app) .scalar-card,
    :where(.scalar-app) pre,
    :where(.scalar-app) button,
    :where(.scalar-app) input,
    :where(.scalar-app) select,
    :where(.scalar-app) textarea {
      box-shadow: 2px 2px 0 #171717;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :where(.scalar-app) *,
    :where(.scalar-app) *::before,
    :where(.scalar-app) *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      scroll-behavior: auto !important;
      transition-duration: 0.01ms !important;
    }
  }
`;

const mount = document.querySelector('#scalar-api-reference');

if (mount) {
  createApiReference(mount, {
    url: './api/openapi.yaml',
    theme: 'none',
    darkMode: false,
    forceDarkModeState: 'light',
    hideDarkModeToggle: true,
    showSidebar: true,
    hideSearch: false,
    operationTitleSource: 'summary',
    showOperationId: true,
    telemetry: false,
    withDefaultFonts: false,
    hideTestRequestButton: true,
    showDeveloperTools: 'never',
    agent: { disabled: true },
    customCss: neoBrutalistCss,
  });
}
