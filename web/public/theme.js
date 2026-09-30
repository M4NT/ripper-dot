// Aplica o tema salvo antes da primeira pintura (arquivo externo por causa da CSP).
try { const t = localStorage.getItem('ripper.theme'); if (t) document.documentElement.dataset.theme = JSON.parse(t); } catch {}
