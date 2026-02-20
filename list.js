/* 키 링크 */
.key-link {
  display: inline-block;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.18);
  color: rgba(255,255,255,0.92);
  text-decoration: none;
  background: rgba(255,255,255,0.06);
  cursor: pointer;
  white-space: nowrap;
}

.key-link:hover {
  background: rgba(255,255,255,0.10);
}

.key-link-disabled {
  background: rgba(255,255,255,0.04);
  opacity: 0.85;
}

.key-link-disabled.copied {
  border-color: rgba(120, 255, 190, 0.55);
  box-shadow: 0 0 0 2px rgba(120, 255, 190, 0.18);
}

/* 가독성: 물건명/소재지 최소폭 확보(가능하면) */
.col-title { min-width: 340px; }
.col-addr  { min-width: 220px; }
.col-money { text-align: right; white-space: nowrap; }
.col-ratio, .col-small { text-align: center; white-space: nowrap; }
