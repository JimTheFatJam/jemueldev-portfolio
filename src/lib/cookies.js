/** Minimal cookie parser middleware (avoids a dependency for ~15 lines). */
export function cookieParser(req, _res, next) {
  const header = req.headers.cookie;
  const jar = {};
  if (header) {
    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      const name = part.slice(0, eq).trim();
      if (!name) continue;
      let value = part.slice(eq + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      try {
        jar[name] = decodeURIComponent(value);
      } catch {
        jar[name] = value;
      }
    }
  }
  req.cookies = jar;
  next();
}
