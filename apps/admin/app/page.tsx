import { ethiopianDateOf, formatEthiopianDate } from '@temelash/ethiopian-calendar';
import { t } from '@temelash/i18n';
import { Card, DesktopShell, Wordmark } from '@temelash/ui';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <DesktopShell>
      <Wordmark />
      <Card>
        <p style={{ margin: 0 }}>{t('en', 'admin.placeholder')}</p>
        <p style={{ margin: '8px 0 0', color: 'var(--tc-text-muted)', fontSize: 13 }}>{formatEthiopianDate(ethiopianDateOf(new Date()))}</p>
      </Card>
    </DesktopShell>
  );
}
