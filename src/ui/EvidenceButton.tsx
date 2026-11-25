import { useEffect, useState } from 'react';
import { Camera } from 'lucide-react';
import { api } from '../lib/api.ts';
import { db, photoBlob } from '../lib/db.ts';
import { Modal } from './components.tsx';

export function EvidenceButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="text-button" onClick={() => setOpen(true)}>
        <Camera size={15} />
        Ver foto
      </button>
      {open && <EvidencePreview key={id} id={id} onClose={() => setOpen(false)} />}
    </>
  );
}

function EvidencePreview({ id, onClose }: { id: string; onClose: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const [src, setSrc] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let localUrl: string | undefined;
    async function load() {
      const local = await db.photos.get(id);
      if (!active) return;
      if (local) {
        localUrl = URL.createObjectURL(photoBlob(local));
        setSrc(localUrl);
        return;
      }
      const { url } = await api<{ url: string }>(`attachments/read?id=${encodeURIComponent(id)}`);
      if (active) setSrc(url);
    }
    void load().catch((failure: Error) => {
      if (active) setError(failure.message);
    });
    return () => {
      active = false;
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [id, attempt]);

  return (
    <Modal title="Foto de soporte" onClose={onClose}>
      <div className="evidence-preview">
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setError('');
                setSrc(undefined);
                setLoaded(false);
                setAttempt((value) => value + 1);
              }}
            >
              Reintentar
            </button>
          </>
        ) : (
          <>
            {!loaded && <p role="status">Cargando foto…</p>}
            {src && (
              <img
                src={src}
                alt="Foto de soporte"
                hidden={!loaded}
                referrerPolicy="no-referrer"
                onLoad={() => setLoaded(true)}
                onError={() => setError('No se pudo mostrar la foto de soporte.')}
              />
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
