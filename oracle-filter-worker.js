// Filter rows in a separate thread to prevent UI blocking
// Receives filter queries and row data, returns indices of matching rows

self.onmessage = (e) => {
  const { queries, rows } = e.data || {};
  
  if (!Array.isArray(rows) || !Array.isArray(queries)) {
    self.postMessage({ ok: false, error: 'Invalid input' });
    return;
  }

  try {
    // Filter rows: each query must match in searchIndex
    const matchingIndices = [];
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const searchIndex = String(row.searchIndex || '').toLowerCase();
      
      // All queries must match (AND logic)
      const matches = queries.every(query => {
        // Each query can have multiple tokens (space-separated)
        return query.split(/\s+/).every(token => searchIndex.includes(token));
      });
      
      if (matches) {
        matchingIndices.push(i);
      }
    }
    
    self.postMessage({ ok: true, matchingIndices });
  } catch (err) {
    self.postMessage({ ok: false, error: err && err.message ? err.message : String(err) });
  }
};
