// Business profile building blocks (wizard + Profile page).
import { useState } from 'react';
import { bizApi, errMsg, fileToBase64 } from '../../api';
import { useMeta } from '../../shared/hooks';
import { StatusPill } from '../../shared/StatusPill';
import { dateTime, docLabel } from '../../shared/format';
import { Icons } from '../../shared/icons';
import { Button, EmptyState, Field, InlineError, Input, Pill, Select, useToast } from '../../ui';
import type { Business, BusinessDoc } from '../../types';

type OnBiz = (b: Business) => void;

function useProfileSave(onSaved: OnBiz, okMsg: string) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const save = async (body: Record<string, unknown>) => {
    setPending(true);
    setError(null);
    try {
      const r = await bizApi.put<{ business: Business }>('/business/profile', body);
      toast(okMsg);
      onSaved(r.business);
      return true;
    } catch (e) {
      setError(errMsg(e));
      return false;
    } finally {
      setPending(false);
    }
  };
  return { pending, error, setError, save };
}

export function BusinessInfoForm({ business, onSaved }: { business: Business; onSaved: OnBiz }) {
  const [f, setF] = useState({ name: business.name || '', legal_name: business.legal_name || '' });
  const { pending, error, save, setError } = useProfileSave(onSaved, 'Business information saved');
  return (
    <div className="stack">
      <div className="form-grid">
        <Field label="Business name (shown to customers)" required>
          <Input value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Registered legal name" hint="As on your GST / PAN documents">
          <Input value={f.legal_name} maxLength={160} onChange={(e) => setF({ ...f, legal_name: e.target.value })} />
        </Field>
      </div>
      <InlineError message={error} />
      <div>
        <Button pending={pending} onClick={() => (f.name.trim() ? save(f) : setError('Business name is required'))}>
          Save business information
        </Button>
      </div>
    </div>
  );
}

export function OwnerForm({ business, onSaved }: { business: Business; onSaved: OnBiz }) {
  const [f, setF] = useState({ owner_name: business.owner_name || '', phone: business.phone || '', email: business.email || '' });
  const { pending, error, save } = useProfileSave(onSaved, 'Owner information saved');
  return (
    <div className="stack">
      <div className="form-grid">
        <Field label="Owner / manager name" required>
          <Input value={f.owner_name} maxLength={80} onChange={(e) => setF({ ...f, owner_name: e.target.value })} />
        </Field>
        <Field label="Business phone" required hint="Used by Pandal only; customers chat through the app">
          <Input type="tel" inputMode="numeric" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
        <Field label="Business email">
          <Input type="email" value={f.email} maxLength={120} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
      </div>
      <InlineError message={error} />
      <div>
        <Button pending={pending} onClick={() => save(f)}>
          Save owner information
        </Button>
      </div>
    </div>
  );
}

export function AddressForm({ business, onSaved }: { business: Business; onSaved: OnBiz }) {
  const [f, setF] = useState({ address: business.address || '', city: business.city || '', state: business.state || '', pincode: business.pincode || '' });
  const { pending, error, save, setError } = useProfileSave(onSaved, 'Address saved');
  const submit = () => {
    if (!f.address.trim() || !f.city.trim()) return setError('Address and city are required');
    if (!/^\d{6}$/.test(f.pincode)) return setError('Pincode must be 6 digits');
    save(f);
  };
  return (
    <div className="stack">
      <p className="muted">Your registered business address (for invoices and payouts). The venue's exact location is set on the map in a later step.</p>
      <div className="form-grid">
        <Field label="Address" required className="span-2">
          <Input value={f.address} maxLength={250} onChange={(e) => setF({ ...f, address: e.target.value })} />
        </Field>
        <Field label="City" required>
          <Input value={f.city} maxLength={80} onChange={(e) => setF({ ...f, city: e.target.value })} />
        </Field>
        <Field label="State">
          <Input value={f.state} maxLength={80} onChange={(e) => setF({ ...f, state: e.target.value })} />
        </Field>
        <Field label="Pincode" required>
          <Input value={f.pincode} inputMode="numeric" maxLength={6} onChange={(e) => setF({ ...f, pincode: e.target.value.replace(/\D/g, '') })} />
        </Field>
      </div>
      <InlineError message={error} />
      <div>
        <Button pending={pending} onClick={submit}>
          Save address
        </Button>
      </div>
    </div>
  );
}

export function BankForm({ business, onSaved }: { business: Business; onSaved: OnBiz }) {
  const [f, setF] = useState({ bank_holder: business.bank_holder || '', bank_account: '', bank_ifsc: business.bank_ifsc || '', gstin: business.gstin || '', pan: '' });
  const { pending, error, save, setError } = useProfileSave(onSaved, 'Bank & tax details saved');
  const submit = async () => {
    if (!f.bank_holder.trim()) return setError('Account holder name is required');
    if (!business.bank_account_masked && !f.bank_account) return setError('Enter your bank account number');
    if (f.bank_account && !/^\d{9,18}$/.test(f.bank_account)) return setError('Bank account number must be 9–18 digits');
    const body: Record<string, unknown> = { bank_holder: f.bank_holder, bank_ifsc: f.bank_ifsc.toUpperCase(), gstin: f.gstin.toUpperCase() };
    if (f.bank_account) body.bank_account = f.bank_account;
    if (f.pan) body.pan = f.pan.toUpperCase();
    if (await save(body)) setF((x) => ({ ...x, bank_account: '', pan: '' }));
  };
  return (
    <div className="stack">
      <p className="muted">
        {Icons.lock} Bank account and PAN are encrypted. Only the last 4 digits are ever shown back.
      </p>
      <div className="form-grid">
        <Field label="Account holder name" required>
          <Input value={f.bank_holder} maxLength={120} onChange={(e) => setF({ ...f, bank_holder: e.target.value })} />
        </Field>
        <Field label="IFSC" required hint="e.g. HDFC0001234">
          <Input value={f.bank_ifsc} maxLength={11} onChange={(e) => setF({ ...f, bank_ifsc: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Account number" required={!business.bank_account_masked} hint={business.bank_account_masked ? `On file: ${business.bank_account_masked}. Enter a new number only to change it.` : '9–18 digits'}>
          <Input value={f.bank_account} inputMode="numeric" autoComplete="off" placeholder={business.bank_account_masked || ''} onChange={(e) => setF({ ...f, bank_account: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label="GSTIN" hint="15 characters, e.g. 06ABCDE1234F1Z5 (optional if not registered)">
          <Input value={f.gstin} maxLength={15} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="PAN" hint={business.has_pan ? 'PAN on file. Enter again only to change it.' : 'e.g. ABCDE1234F'}>
          <Input value={f.pan} maxLength={10} autoComplete="off" placeholder={business.has_pan ? 'XXXXX••••X (on file)' : ''} onChange={(e) => setF({ ...f, pan: e.target.value.toUpperCase() })} />
        </Field>
      </div>
      {business.bank_account_masked && (
        <div className="row">
          <Pill tone="success">Bank on file: {business.bank_account_masked}</Pill>
          {business.bank_ifsc && <Pill>{business.bank_ifsc}</Pill>}
        </div>
      )}
      <InlineError message={error} />
      <div>
        <Button pending={pending} onClick={submit}>
          Save bank & tax details
        </Button>
      </div>
    </div>
  );
}

export function DocumentsStep({ documents, onChanged }: { documents: BusinessDoc[]; onChanged: () => void }) {
  const meta = useMeta();
  const [kind, setKind] = useState('gst_certificate');
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const upload = async () => {
    if (!file) return setError('Choose a file first');
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) return setError('Upload a PDF, JPG or PNG file');
    if (file.size > 8 * 1024 * 1024) return setError('Documents must be under 8 MB');
    setPending(true);
    setError(null);
    try {
      const data_base64 = await fileToBase64(file);
      await bizApi.post('/business/documents', { kind, file_name: file.name, mime: file.type, data_base64 });
      toast('Document uploaded');
      setFile(null);
      setInputKey((k) => k + 1);
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="stack">
      <p className="muted">Upload at least one: GST certificate, PAN, trade licence, fire NOC, property proof or a cancelled cheque. Documents are private and only seen by the Pandal verification team.</p>
      <div className="dropzone">
        <Field label="Document type">
          <Select value={kind} onChange={(e) => setKind(e.target.value)} options={(meta.data?.document_kinds || []).map((k) => ({ value: k, label: docLabel(k) }))} />
        </Field>
        <Field label="File (PDF, JPG or PNG, max 8 MB)">
          <input key={inputKey} type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </Field>
        <Button icon={Icons.upload} pending={pending} onClick={upload}>
          Upload
        </Button>
      </div>
      <InlineError message={error} />
      {documents.length === 0 ? (
        <EmptyState title="No documents uploaded" />
      ) : (
        <div>
          {documents.map((d) => (
            <div key={d.id} className="doc-row">
              <div>
                <div className="cell-main">{docLabel(d.kind)}</div>
                <div className="cell-sub">
                  {d.file_name} · {dateTime(d.uploaded_at)}
                </div>
                {d.note && <div className="small" style={{ color: d.status === 'REJECTED' ? 'var(--danger)' : undefined }}>Note: {d.note}</div>}
              </div>
              <StatusPill status={d.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
