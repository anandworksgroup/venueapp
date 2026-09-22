import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../core/theme.dart';
import '../data/api.dart';
import '../state/app_state.dart';
import 'common.dart';

/// Phone + OTP sign-in, shown only when it's needed (booking, saving,
/// My Events) — browsing never requires an account.
Future<bool> showLoginSheet(BuildContext context, {String? reason}) async {
  final ok = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    builder: (_) => _LoginSheet(reason: reason),
  );
  return ok == true;
}

class _LoginSheet extends StatefulWidget {
  final String? reason;
  const _LoginSheet({this.reason});
  @override
  State<_LoginSheet> createState() => _LoginSheetState();
}

class _LoginSheetState extends State<_LoginSheet> {
  final _phone = TextEditingController();
  final _otp = TextEditingController();
  final _name = TextEditingController();
  bool _otpSent = false;
  bool _busy = false;
  String? _error;
  String? _devOtp;

  @override
  void dispose() {
    _phone.dispose();
    _otp.dispose();
    _name.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = await Api.instance.post('/auth/otp/request', {'phone': _phone.text});
      _devOtp = r['dev_otp'];
      if (_devOtp != null) _otp.text = _devOtp!;
      setState(() => _otpSent = true);
    } catch (e) {
      setState(() => _error = errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verify() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = await Api.instance.post('/auth/otp/verify', {
        'phone': _phone.text,
        'code': _otp.text.trim(),
        if (_name.text.trim().isNotEmpty) 'name': _name.text.trim(),
      });
      if (!mounted) return;
      final app = context.read<AppState>();
      await app.signIn(r['token'], Map<String, dynamic>.from(r['user']));
      if (r['is_new'] == false && _name.text.trim().isNotEmpty && (r['user']['name'] == null)) {
        await app.updateName(_name.text.trim());
      }
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      setState(() => _error = errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(24, 0, 24, MediaQuery.of(context).viewInsets.bottom + 24),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(_otpSent ? 'Enter the OTP' : 'Sign in to continue', style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 6),
        Text(
          _otpSent ? 'We sent a 6-digit code to +91 ${_phone.text}' : (widget.reason ?? 'Use your mobile number — no passwords.'),
          style: const TextStyle(color: Brand.inkSoft),
        ),
        const SizedBox(height: 20),
        if (!_otpSent)
          TextField(
            controller: _phone,
            autofocus: true,
            keyboardType: TextInputType.phone,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(10)],
            decoration: const InputDecoration(prefixText: '+91  ', labelText: 'Mobile number'),
            onSubmitted: (_) => _send(),
          )
        else ...[
          TextField(
            controller: _otp,
            autofocus: _devOtp == null,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
            style: const TextStyle(letterSpacing: 8, fontSize: 22, fontWeight: FontWeight.w800),
            decoration: const InputDecoration(labelText: 'OTP'),
          ),
          if (_devOtp != null)
            const Padding(
              padding: EdgeInsets.only(top: 6),
              child: Text('Development build: OTP filled in automatically.', style: TextStyle(color: Brand.muted, fontSize: 12)),
            ),
          const SizedBox(height: 12),
          TextField(
            controller: _name,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(labelText: 'Your name (for new accounts)'),
          ),
        ],
        if (_error != null) ...[
          const SizedBox(height: 10),
          Text(_error!, style: const TextStyle(color: Brand.danger, fontWeight: FontWeight.w600)),
        ],
        const SizedBox(height: 20),
        SizedBox(
          width: double.infinity,
          child: FilledButton(
            onPressed: _busy ? null : (_otpSent ? _verify : _send),
            child: _busy
                ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
                : Text(_otpSent ? 'Verify & continue' : 'Get OTP'),
          ),
        ),
        if (_otpSent)
          Center(
            child: TextButton(
              onPressed: _busy ? null : () => setState(() => _otpSent = false),
              child: const Text('Change number'),
            ),
          ),
        const SizedBox(height: 4),
        const Text('By continuing you agree to Pandal\'s Terms and Privacy Policy.', style: TextStyle(color: Brand.muted, fontSize: 11.5)),
      ]),
    );
  }
}
