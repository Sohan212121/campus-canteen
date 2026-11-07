export function renderServiceUnavailableHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Service Temporarily Unavailable | C@mpBite</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #090A0F;
      --card-bg: #121319;
      --border: #222533;
      --text: #F3F4F6;
      --muted: #9CA3AF;
      --primary: #F59E0B;
      --primary-hover: #D97706;
      --btn-text: #000000;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #FAFAF9;
        --card-bg: #FFFFFF;
        --border: #E5E7EB;
        --text: #1F2937;
        --muted: #6B7280;
        --primary: #F59E0B;
        --primary-hover: #D97706;
        --btn-text: #000000;
      }
    }
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      box-sizing: border-box;
      padding: 1.5rem;
    }
    .card {
      background-color: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 1.25rem;
      padding: 2rem;
      max-width: 26rem;
      width: 100%;
      text-align: center;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
    }
    .icon {
      width: 3.5rem;
      height: 3.5rem;
      margin: 0 auto 1.25rem;
      border-radius: 50%;
      background-color: rgba(245, 158, 11, 0.15);
      color: var(--primary);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    h1 {
      font-size: 1.25rem;
      font-weight: 700;
      margin: 0 0 0.5rem;
      letter-spacing: -0.025em;
    }
    p {
      font-size: 0.875rem;
      color: var(--muted);
      line-height: 1.5;
      margin: 0 0 1.5rem;
    }
    .btn {
      display: inline-block;
      width: 100%;
      box-sizing: border-box;
      padding: 0.75rem 1.25rem;
      font-size: 0.875rem;
      font-weight: 600;
      border-radius: 0.75rem;
      border: none;
      background-color: var(--primary);
      color: var(--btn-text);
      cursor: pointer;
      transition: background-color 0.15s ease;
      text-decoration: none;
    }
    .btn:hover {
      background-color: var(--primary-hover);
    }
    .btn:active {
      transform: scale(0.98);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
    </div>
    <h1>We can't reach the service right now</h1>
    <p>Please try again in a moment. Your session and order are safe.</p>
    <button class="btn" onclick="window.location.reload()">Retry</button>
  </div>
</body>
</html>`;
}
