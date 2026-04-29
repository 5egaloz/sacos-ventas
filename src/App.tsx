import React, { useState, useEffect, useRef, useMemo } from 'react';
import { doc, setDoc, onSnapshot } from 'firebase/firestore';
import { db, isFirebaseConfigured } from './firebase';

type PaymentStatus = 'contado' | 'transferencia' | 'pendiente';

interface Transaction {
  id: string;
  date: string;
  type: 'sale' | 'restock';
  sacks: number;
  totalPrice?: number;
  paymentStatus?: PaymentStatus;
}

const LS_TX = 'ventas-lena-tx';
const LS_INV = 'ventas-lena-inv';
const FS_DOC = 'data';
const FS_COL = 'ventas-sacos';

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);

const formatDate = (dateString: string) =>
  new Date(dateString).toLocaleString('es-CL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

const toMonthKey = (dateString: string) => {
  const d = new Date(dateString);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

function App() {
  const [loading, setLoading] = useState(isFirebaseConfigured);
  const [syncError, setSyncError] = useState<string | null>(null);
  const initialLoadDone = useRef(false);
  const skipNextSave = useRef(false);

  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    const saved = localStorage.getItem(LS_TX);
    return saved ? JSON.parse(saved) : [];
  });

  const [inventory, setInventory] = useState<number>(() => {
    const saved = localStorage.getItem(LS_INV);
    return saved ? parseInt(saved, 10) : 0;
  });

  // Derived metrics (all-time totals)
  const { totalRevenue, totalSacksSold, pendingRevenue } = useMemo(() => {
    let rev = 0, sacks = 0, pend = 0;
    transactions.forEach(tx => {
      if (tx.type === 'sale') {
        sacks += tx.sacks;
        if (tx.paymentStatus !== 'pendiente') {
          rev += tx.totalPrice || 0;
        } else {
          pend += tx.totalPrice || 0;
        }
      }
    });
    return { totalRevenue: rev, totalSacksSold: sacks, pendingRevenue: pend };
  }, [transactions]);

  // Sync with Firestore in real time
  useEffect(() => {
    if (!isFirebaseConfigured || !db) {
      initialLoadDone.current = true;
      return;
    }

    const unsubscribe = onSnapshot(
      doc(db, FS_COL, FS_DOC),
      (snapshot) => {
        // Skip snapshots caused by our own pending write to avoid loops
        if (snapshot.metadata.hasPendingWrites) return;

        if (snapshot.exists()) {
          skipNextSave.current = true;
          const data = snapshot.data();
          setTransactions(data.transactions ?? []);
          setInventory(data.inventory ?? 0);
        }

        if (!initialLoadDone.current) {
          initialLoadDone.current = true;
          setLoading(false);
        }
      },
      (err) => {
        setSyncError('Error al conectar con la nube. Usando datos locales.');
        console.error(err);
        if (!initialLoadDone.current) {
          initialLoadDone.current = true;
          setLoading(false);
        }
      }
    );

    return () => unsubscribe();
  }, []);

  // Persist to localStorage + Firestore on every local change
  useEffect(() => {
    if (!initialLoadDone.current) return;
    // Update came from Firestore, skip saving back to avoid loops
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }

    localStorage.setItem(LS_TX, JSON.stringify(transactions));
    localStorage.setItem(LS_INV, inventory.toString());

    if (!isFirebaseConfigured || !db) return;

    setDoc(doc(db, FS_COL, FS_DOC), {
      transactions,
      inventory,
      lastUpdated: new Date().toISOString(),
    })
      .then(() => setSyncError(null))
      .catch(err => {
        setSyncError('Error al guardar en la nube.');
        console.error(err);
      });
  }, [transactions, inventory]);

  // Form states
  const [saleSacks, setSaleSacks] = useState<string>('');
  const [salePrice, setSalePrice] = useState<string>('');
  const [saleStatus, setSaleStatus] = useState<PaymentStatus>('contado');
  const [restockAmount, setRestockAmount] = useState<string>('');

  // History filter
  const [monthFilter, setMonthFilter] = useState<string>('all');

  const availableMonths = useMemo(() => {
    const months = new Set(transactions.map(tx => toMonthKey(tx.date)));
    return Array.from(months).sort().reverse();
  }, [transactions]);

  const filteredTransactions = useMemo(() => {
    if (monthFilter === 'all') return transactions;
    return transactions.filter(tx => toMonthKey(tx.date) === monthFilter);
  }, [transactions, monthFilter]);

  const handleSaleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const s = parseInt(saleSacks);
    const p = parseInt(salePrice);
    if (isNaN(s) || s <= 0 || isNaN(p) || p < 0) return;
    if (s > inventory) {
      alert('¡No tienes suficientes sacos en inventario para esta venta!');
      return;
    }
    const newTx: Transaction = {
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      type: 'sale',
      sacks: s,
      totalPrice: p,
      paymentStatus: saleStatus,
    };
    setTransactions(prev => [newTx, ...prev]);
    setInventory(prev => prev - s);
    setSaleSacks('');
    setSalePrice('');
    setSaleStatus('contado');
  };

  const handleRestockSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseInt(restockAmount);
    if (isNaN(amount) || amount <= 0) return;
    const newTx: Transaction = {
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      type: 'restock',
      sacks: amount,
    };
    setTransactions(prev => [newTx, ...prev]);
    setInventory(prev => prev + amount);
    setRestockAmount('');
  };

  const handleDelete = (id: string, type: 'sale' | 'restock', sacks: number) => {
    if (type === 'restock' && inventory - sacks < 0) {
      alert(
        `No puedes eliminar este ingreso: el inventario quedaría en ${inventory - sacks} sacos.\n` +
        `Elimina primero las ventas correspondientes.`
      );
      return;
    }
    if (window.confirm('¿Estás seguro de que quieres eliminar este registro? Esto ajustará tu inventario.')) {
      setTransactions(prev => prev.filter(tx => tx.id !== id));
      setInventory(prev => type === 'sale' ? prev + sacks : prev - sacks);
    }
  };

  const handlePaymentStatusChange = (id: string, newStatus: PaymentStatus) => {
    setTransactions(prev =>
      prev.map(tx => tx.id === id ? { ...tx, paymentStatus: newStatus } : tx)
    );
  };

  if (loading) {
    return (
      <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>Cargando datos desde la nube...</p>
      </div>
    );
  }

  return (
    <div className="app-container">
      <h1>🌲 Gestión de Ventas de Leña</h1>

      {/* Sync status indicator */}
      <div style={{ textAlign: 'center', marginBottom: '0.5rem', fontSize: '0.78rem' }}>
        {syncError ? (
          <span style={{ color: 'var(--danger)' }}>⚠️ {syncError}</span>
        ) : isFirebaseConfigured ? (
          <span style={{ color: 'var(--success)' }}>☁️ Datos guardados en la nube</span>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>💾 Guardando solo en este dispositivo</span>
        )}
      </div>

      <div className="dashboard-grid">
        <div className="stat-card">
          <h3>Inventario</h3>
          <div className="value" style={{ color: inventory < 10 ? 'var(--danger)' : 'var(--primary-color)' }}>
            {inventory} <span style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>sacos</span>
          </div>
        </div>
        <div className="stat-card">
          <h3>Sacos Vendidos</h3>
          <div className="value">{totalSacksSold}</div>
        </div>
        <div className="stat-card">
          <h3>Ingresos Cobrados</h3>
          <div className="value" style={{ color: 'var(--success)' }}>{formatCurrency(totalRevenue)}</div>
        </div>
        <div className="stat-card">
          <h3>Cobros Pendientes</h3>
          <div className="value" style={{ color: 'var(--danger)' }}>{formatCurrency(pendingRevenue)}</div>
        </div>
      </div>

      <div className="forms-section">
        <form onSubmit={handleSaleSubmit}>
          <h2>Anotar Venta</h2>
          <label>
            Cantidad de Sacos:
            <input
              type="number"
              value={saleSacks}
              onChange={e => setSaleSacks(e.target.value)}
              placeholder="Ej: 5"
              min="1"
              required
            />
          </label>
          <label>
            Precio Total de la venta:
            <input
              type="number"
              value={salePrice}
              onChange={e => setSalePrice(e.target.value)}
              placeholder="Ej: 20000"
              min="0"
              required
            />
          </label>
          <label>
            Método de Pago:
            <select value={saleStatus} onChange={e => setSaleStatus(e.target.value as PaymentStatus)}>
              <option value="contado">Efectivo / Contado</option>
              <option value="transferencia">Transferencia</option>
              <option value="pendiente">Pendiente (Por Cobrar)</option>
            </select>
          </label>
          <button type="submit">Guardar Venta</button>
        </form>

        <form onSubmit={handleRestockSubmit}>
          <h2>Agregar Inventario</h2>
          <label>
            Nuevos Sacos Creados:
            <input
              type="number"
              value={restockAmount}
              onChange={e => setRestockAmount(e.target.value)}
              placeholder="Ej: 50"
              min="1"
              required
            />
          </label>
          <button type="submit" style={{ backgroundColor: 'var(--success)', marginTop: 'auto' }}>Añadir Leña</button>
        </form>
      </div>

      <div className="history-section">
        <h2>
          Historial
          <select
            value={monthFilter}
            onChange={e => setMonthFilter(e.target.value)}
            style={{ fontSize: '0.85rem', fontWeight: 'normal', padding: '4px 8px', borderRadius: '8px', border: '1px solid #d1d5db' }}
          >
            <option value="all">Todos los meses</option>
            {availableMonths.map(m => {
              const [year, month] = m.split('-');
              const label = new Date(parseInt(year), parseInt(month) - 1).toLocaleString('es-CL', { month: 'long', year: 'numeric' });
              return <option key={m} value={m}>{label}</option>;
            })}
          </select>
        </h2>

        {filteredTransactions.length === 0 ? (
          <div className="empty-state">
            {monthFilter === 'all'
              ? 'No hay movimientos registrados aún. Empieza anotando leña o una venta.'
              : 'No hay movimientos para este período.'}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Movimiento</th>
                <th>Cantidad</th>
                <th>Total ($)</th>
                <th>$/Saco</th>
                <th>Estado</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.map(tx => (
                <tr key={tx.id}>
                  <td>{formatDate(tx.date)}</td>
                  <td>{tx.type === 'sale' ? 'Venta' : 'Ingreso Inventario'}</td>
                  <td>
                    {tx.type === 'sale' ? (
                      <span style={{ color: 'var(--danger)', fontWeight: 'bold' }}>-{tx.sacks}</span>
                    ) : (
                      <span style={{ color: 'var(--success)', fontWeight: 'bold' }}>+{tx.sacks}</span>
                    )}
                  </td>
                  <td>{tx.type === 'sale' ? formatCurrency(tx.totalPrice || 0) : '-'}</td>
                  <td>
                    {tx.type === 'sale' && tx.sacks > 0
                      ? formatCurrency(Math.round((tx.totalPrice || 0) / tx.sacks))
                      : '-'}
                  </td>
                  <td>
                    {tx.type === 'sale' && tx.paymentStatus && (
                      <select
                        value={tx.paymentStatus}
                        onChange={(e) => handlePaymentStatusChange(tx.id, e.target.value as PaymentStatus)}
                        style={{
                          padding: '4px 8px',
                          borderRadius: '999px',
                          fontSize: '0.75rem',
                          fontWeight: 'bold',
                          textTransform: 'uppercase',
                          backgroundColor: tx.paymentStatus === 'contado' ? '#dcfce7' : tx.paymentStatus === 'transferencia' ? '#dbeafe' : '#fee2e2',
                          color: tx.paymentStatus === 'contado' ? '#166534' : tx.paymentStatus === 'transferencia' ? '#1e40af' : '#991b1b',
                          border: 'none',
                          outline: 'none',
                          cursor: 'pointer',
                        }}
                      >
                        <option value="contado">CONTADO</option>
                        <option value="transferencia">TRANSFERENCIA</option>
                        <option value="pendiente">PENDIENTE</option>
                      </select>
                    )}
                  </td>
                  <td>
                    <button
                      onClick={() => handleDelete(tx.id, tx.type, tx.sacks)}
                      style={{ backgroundColor: 'transparent', color: 'var(--danger)', padding: '4px 8px', fontSize: '0.8rem' }}
                    >
                      ❌
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default App;
