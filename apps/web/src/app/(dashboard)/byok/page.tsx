import { isEncryptionConfigured } from '@llmgw/db/http';
import { BYOKView } from '@/components/byok-view';
import { listProviderKeys, listProvidersForSelect } from '@/lib/byok';
import { getCurrentOrg } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const org = await getCurrentOrg();
  const keys = org ? await listProviderKeys(org.id) : [];
  const providers = org ? await listProvidersForSelect() : [];
  return (
    <BYOKView
      keys={keys}
      providers={providers}
      connected={!!org}
      encryptionReady={isEncryptionConfigured()}
    />
  );
}
