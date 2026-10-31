import { ethiopianDateOf, formatEthiopianDate } from '@temelash/ethiopian-calendar';
import { t } from '@temelash/i18n';
import { Card, MobileShell, Wordmark } from '@temelash/ui';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <MobileShell>
      <Wordmark />
      <Card>
        <p style={{ margin: 0 }}>{t('en', 'staff.placeholder')}</p>
        <p style={{ margin: '8px 0 0', color: 'var(--tc-text-muted)', fontSize: 13 }}>{formatEthiopianDate(ethiopianDateOf(new Date()))}</p>
      </Card>
    </MobileShell>
  );
}
