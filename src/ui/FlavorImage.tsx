import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import { db, photoBlob } from '../lib/db.ts';
import { useApp } from '../lib/store.tsx';
import { catalogFlavorPhoto } from '../domain/flavors.ts';

export function FlavorImage({ imageId, name }: { imageId?: string; name: string }) {
  const app = useApp();
  const [url, setUrl] = useState('');
  useEffect(() => {
    let cancelled = false,
      localUrl = '';
    setUrl('');
    if (imageId)
      void (async () => {
        const local = await db.photos.get(imageId);
        const source = local
          ? (localUrl = URL.createObjectURL(photoBlob(local)))
          : (await api<{ url: string }>(`attachments/read?id=${encodeURIComponent(imageId)}`)).url;
        if (!cancelled) setUrl(source);
      })().catch(() => {});
    return () => {
      cancelled = true;
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [imageId, app.online, app.data?.actor.branchId]);
  const badge = catalogFlavorPhoto(name);
  const source = url || badge;
  return source ? (
    <span className={url ? 'flavor-photo' : 'flavor-photo flavor-photo-badge'}>
      <img src={source} alt="" loading="lazy" onError={() => setUrl('')} />
    </span>
  ) : null;
}
