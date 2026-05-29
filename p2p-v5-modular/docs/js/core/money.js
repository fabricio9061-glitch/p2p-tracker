export const roundMoney = (n, d = 2) => {
  const x = Number(n || 0);
  const p = 10 ** d;
  return Math.round((x + Number.EPSILON) * p) / p;
};

export const truncMoney = (n, d = 2) => {
  const x = Number(n || 0);
  const p = 10 ** d;
  return Math.trunc(x * p) / p;
};

export const fmt = (n, d = 2) => Number(n || 0).toLocaleString('es-UY', {
  minimumFractionDigits: d,
  maximumFractionDigits: d
});

export const uid = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
export const today = () => new Date().toISOString().slice(0, 10);
export const timeNow = () => new Date().toLocaleTimeString('es-UY', {hour:'2-digit', minute:'2-digit', hour12:false});
