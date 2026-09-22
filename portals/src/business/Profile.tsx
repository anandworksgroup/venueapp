import { Link, useNavigate } from 'react-router-dom';
import { pct } from '../shared/format';
import { Icons } from '../shared/icons';
import { StatusPill } from '../shared/StatusPill';
import { Button, Card, KeyValue, PageHeader } from '../ui';
import { useBiz } from './context';
import { AddressForm, BankForm, BusinessInfoForm, DocumentsStep, OwnerForm } from './steps/ProfileForms';

export function ProfilePage() {
  const { me, reloadMe, logout } = useBiz();
  const navigate = useNavigate();
  const b = me.business!;
  const reload = () => {
    reloadMe();
  };
  return (
    <>
      <PageHeader
        title="Business profile"
        subtitle="Your business, payout and tax details."
        actions={
          <Button
            variant="secondary"
            icon={Icons.logout}
            onClick={() => {
              logout();
              navigate('/business/login');
            }}
          >
            Log out
          </Button>
        }
      />
      <div className="split">
        <div className="stack">
          <Card title="Business information">
            <BusinessInfoForm business={b} onSaved={reload} />
          </Card>
          <Card title="Owner">
            <OwnerForm business={b} onSaved={reload} />
          </Card>
          <Card title="Address">
            <AddressForm business={b} onSaved={reload} />
          </Card>
          <Card title="Bank, GST & PAN">
            <BankForm key={b.bank_account_masked || 'none'} business={b} onSaved={reload} />
          </Card>
          <Card title="Documents">
            <DocumentsStep documents={me.documents || []} onChanged={reload} />
          </Card>
        </div>
        <div className="stack">
          <Card title="Account">
            <KeyValue
              items={[
                ['Status', <StatusPill status={b.status} />],
                ['Signed in as', me.user.email],
                ['Platform commission', pct(b.commission_bps)],
                ['GSTIN', b.gstin || '—'],
                ['PAN', b.has_pan ? 'On file (encrypted)' : 'Not added'],
                ['Bank account', b.bank_account_masked || 'Not added'],
              ]}
            />
            <div className="mt">
              <Link to="/business/verification" className="btn btn-ghost btn-sm">
                Verification status →
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
