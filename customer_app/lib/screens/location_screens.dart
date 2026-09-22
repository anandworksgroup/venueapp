import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/theme.dart';
import '../data/api.dart';
import '../data/location_service.dart';
import '../data/models.dart';
import '../state/app_state.dart';
import '../widgets/common.dart';
import 'shell.dart';

/// First launch: ask for location, with a manual fallback.
class LocationOnboardingScreen extends StatefulWidget {
  const LocationOnboardingScreen({super.key});
  @override
  State<LocationOnboardingScreen> createState() => _LocationOnboardingScreenState();
}

class _LocationOnboardingScreenState extends State<LocationOnboardingScreen> {
  bool _busy = false;

  Future<void> _useGps() async {
    setState(() => _busy = true);
    final place = await detectAndConfirm(context);
    if (!mounted) return;
    setState(() => _busy = false);
    if (place != null) _finish(place);
  }

  Future<void> _manual() async {
    final place = await Navigator.of(context).push<PlaceLocation>(MaterialPageRoute(builder: (_) => const LocationPickerScreen(allowGps: false)));
    if (place != null && mounted) _finish(place);
  }

  Future<void> _finish(PlaceLocation place) async {
    await context.read<AppState>().setLocation(place);
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(MaterialPageRoute(builder: (_) => Shell()), (_) => false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(children: [
            const Align(alignment: Alignment.centerLeft, child: Wordmark(size: 26)),
            const Spacer(),
            Container(
              width: 128,
              height: 128,
              decoration: const BoxDecoration(color: Brand.tealSoft, shape: BoxShape.circle),
              child: const Icon(Icons.location_on_rounded, size: 64, color: Brand.teal),
            ),
            const SizedBox(height: 28),
            Text('Your location', style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 10),
            const Text(
              'Find venues near you, see real distances and what\'s available on your date.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Brand.inkSoft, fontSize: 16, height: 1.4),
            ),
            const Spacer(),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: _busy ? null : _useGps,
                icon: _busy
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
                    : const Icon(Icons.my_location_rounded),
                label: Text(_busy ? 'Finding you…' : 'Allow Location Access'),
              ),
            ),
            const SizedBox(height: 8),
            TextButton(onPressed: _busy ? null : _manual, child: const Text('Enter location manually', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15))),
            const SizedBox(height: 4),
            const Text('We only use your location while you use the app.', style: TextStyle(color: Brand.muted, fontSize: 12)),
          ]),
        ),
      ),
    );
  }
}

/// GPS → reverse geocode → confirm. Handles failures and low accuracy.
/// Returns the confirmed place, or null if the user backed out.
Future<PlaceLocation?> detectAndConfirm(BuildContext context, {bool highAccuracy = false}) async {
  LocationFix fix;
  try {
    fix = await LocationService.locate(highAccuracy: highAccuracy);
  } on ApiException catch (e) {
    if (context.mounted) toast(context, e.message);
    return null;
  }
  if (!context.mounted) return null;
  if (fix.failure != null) {
    final f = fix.failure!;
    final action = await showDialog<String>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text("Couldn't get your location"),
        content: Text(LocationService.describe(f)),
        actions: [
          if (f == LocationFailure.deniedForever || f == LocationFailure.serviceOff)
            TextButton(onPressed: () => Navigator.pop(c, 'settings'), child: const Text('Open settings')),
          if (f == LocationFailure.timeout || f == LocationFailure.unknown)
            TextButton(onPressed: () => Navigator.pop(c, 'retry'), child: const Text('Try again')),
          FilledButton(onPressed: () => Navigator.pop(c, 'manual'), child: const Text('Select manually')),
        ],
      ),
    );
    if (!context.mounted) return null;
    if (action == 'settings') await LocationService.openSettings(f);
    if (action == 'retry' && context.mounted) return detectAndConfirm(context, highAccuracy: true);
    if (action == 'manual' && context.mounted) {
      return Navigator.of(context).push<PlaceLocation>(MaterialPageRoute(builder: (_) => const LocationPickerScreen(allowGps: false)));
    }
    return null;
  }
  return Navigator.of(context).push<PlaceLocation>(MaterialPageRoute(builder: (_) => LocationConfirmScreen(fix: fix)));
}

/// "Sector 15, Faridabad — Use this location". Never claims more precision
/// than the fix supports; low accuracy offers Improve / Select manually.
class LocationConfirmScreen extends StatefulWidget {
  final LocationFix fix;
  const LocationConfirmScreen({super.key, required this.fix});
  @override
  State<LocationConfirmScreen> createState() => _LocationConfirmScreenState();
}

class _LocationConfirmScreenState extends State<LocationConfirmScreen> {
  late LocationFix fix = widget.fix;
  bool _improving = false;

  Future<void> _improve() async {
    setState(() => _improving = true);
    try {
      final f = await LocationService.locate(highAccuracy: true);
      if (f.place != null) {
        final better = (f.place!.accuracyM ?? 1e9) < (fix.place!.accuracyM ?? 1e9);
        setState(() => fix = better || fix.confidence == 'low' ? f : fix);
        if (!better && mounted) toast(context, 'Could not get a more accurate fix. Try moving near a window.');
      }
    } catch (e) {
      if (mounted) toast(context, errorText(e));
    } finally {
      if (mounted) setState(() => _improving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = fix.place!;
    final low = fix.confidence == 'low';
    final acc = p.accuracyM;
    return Scaffold(
      appBar: AppBar(title: const Text('Confirm location')),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        Panel(
          margin: EdgeInsets.zero,
          padding: const EdgeInsets.all(20),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(color: low ? Brand.marigoldSoft : Brand.tealSoft, borderRadius: BorderRadius.circular(12)),
                child: Icon(low ? Icons.location_searching_rounded : Icons.location_on_rounded, color: low ? Brand.marigold : Brand.teal),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(p.label, style: Theme.of(context).textTheme.titleLarge),
                  const SizedBox(height: 2),
                  Text(
                    [fix.geo?['confidence_label'], if (acc != null) '±${acc < 1000 ? '${acc.round()} m' : '${(acc / 1000).toStringAsFixed(1)} km'}']
                        .whereType<String>()
                        .join(' · '),
                    style: const TextStyle(color: Brand.inkSoft),
                  ),
                ]),
              ),
            ]),
            if (p.pincode != null) ...[
              const SizedBox(height: 12),
              Text('Pincode ${p.pincode}${p.state != null ? ' · ${p.state}' : ''}', style: const TextStyle(color: Brand.inkSoft)),
            ],
          ]),
        ),
        for (final w in fix.warnings)
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(color: Brand.marigoldSoft, borderRadius: BorderRadius.circular(14)),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Icon(Icons.info_outline_rounded, color: Color(0xFFA86400), size: 20),
                const SizedBox(width: 10),
                Expanded(child: Text(w, style: const TextStyle(color: Color(0xFF7A4B00), fontWeight: FontWeight.w600))),
              ]),
            ),
          ),
        const SizedBox(height: 24),
        if (!low)
          FilledButton(onPressed: () => Navigator.pop(context, p), child: const Text('Use this location')),
        if (fix.confidence == 'low' || fix.confidence == 'city') ...[
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: _improving ? null : _improve,
            icon: _improving ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.gps_fixed_rounded),
            label: const Text('Improve Location'),
          ),
        ],
        const SizedBox(height: 10),
        OutlinedButton(
          onPressed: () async {
            final picked = await Navigator.of(context).push<PlaceLocation>(MaterialPageRoute(builder: (_) => const LocationPickerScreen(allowGps: false)));
            if (picked != null && context.mounted) Navigator.pop(context, picked);
          },
          child: const Text('Select Location Manually'),
        ),
        if (low) ...[
          const SizedBox(height: 10),
          TextButton(onPressed: () => Navigator.pop(context, p), child: Text('Continue with approximate "${p.label}"')),
        ],
      ]),
    );
  }
}

/// "Choose location": search area/city/pincode, use current location,
/// recent locations, popular areas.
class LocationPickerScreen extends StatefulWidget {
  final bool allowGps;
  const LocationPickerScreen({super.key, this.allowGps = true});
  @override
  State<LocationPickerScreen> createState() => _LocationPickerScreenState();
}

class _LocationPickerScreenState extends State<LocationPickerScreen> {
  final _q = TextEditingController();
  Timer? _debounce;
  List<Map<String, dynamic>> _results = [];
  List<Map<String, dynamic>> _popular = [];
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    Api.instance.get('/locations/popular').then((r) {
      if (mounted) setState(() => _popular = List<Map<String, dynamic>>.from(r['items']));
    }).catchError((_) {});
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _q.dispose();
    super.dispose();
  }

  void _onChanged(String v) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 280), () async {
      if (v.trim().length < 2) {
        setState(() => _results = []);
        return;
      }
      setState(() => _loading = true);
      try {
        final r = await Api.instance.get('/locations/search', {'q': v});
        if (mounted) setState(() => _results = List<Map<String, dynamic>>.from(r['items']));
      } catch (_) {
      } finally {
        if (mounted) setState(() => _loading = false);
      }
    });
  }

  PlaceLocation _fromResult(Map<String, dynamic> r) => PlaceLocation(
        lat: (r['lat'] as num).toDouble(),
        lng: (r['lng'] as num).toDouble(),
        label: r['label'],
        area: r['area'],
        city: r['city'],
        state: r['state'],
        pincode: r['pincode'],
        confidence: 'manual',
        source: 'manual',
        radiusKm: r['type'] == 'city' ? 25 : 10,
      );

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    return Scaffold(
      appBar: AppBar(title: const Text('Choose location')),
      body: ListView(padding: const EdgeInsets.fromLTRB(16, 4, 16, 24), children: [
        TextField(
          controller: _q,
          autofocus: !widget.allowGps,
          onChanged: _onChanged,
          decoration: InputDecoration(
            hintText: 'Search area, city or pincode',
            prefixIcon: const Icon(Icons.search_rounded),
            suffixIcon: _loading ? const Padding(padding: EdgeInsets.all(14), child: SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))) : null,
          ),
        ),
        const SizedBox(height: 8),
        if (widget.allowGps)
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.my_location_rounded, color: Brand.teal),
            title: const Text('Use current location', style: TextStyle(color: Brand.teal, fontWeight: FontWeight.w800)),
            subtitle: const Text('Using GPS'),
            onTap: () async {
              final p = await detectAndConfirm(context);
              if (p != null && context.mounted) Navigator.pop(context, p);
            },
          ),
        if (_results.isNotEmpty) ...[
          const _Label('Results'),
          for (final r in _results) _PlaceTile(icon: r['type'] == 'city' ? Icons.location_city_rounded : Icons.place_outlined, title: r['label'], subtitle: r['pincode'], onTap: () => Navigator.pop(context, _fromResult(r))),
        ] else if (_q.text.trim().length >= 2 && !_loading)
          const Padding(padding: EdgeInsets.all(16), child: Text('No matching areas yet. Try a city or 6-digit pincode.', style: TextStyle(color: Brand.inkSoft))),
        if (app.recentLocations.isNotEmpty && _results.isEmpty) ...[
          const _Label('Recent locations'),
          for (final r in app.recentLocations) _PlaceTile(icon: Icons.history_rounded, title: r.shortLabel, subtitle: r.source == 'gps' ? 'Detected via GPS' : null, onTap: () => Navigator.pop(context, r)),
        ],
        if (_popular.isNotEmpty && _results.isEmpty) ...[
          const _Label('Popular areas'),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final p in _popular)
              ActionChip(
                avatar: const Icon(Icons.place_outlined, size: 16),
                label: Text('${p['label']} · ${p['venues']}'),
                onPressed: () => Navigator.pop(context, _fromResult(p)),
              ),
          ]),
        ],
      ]),
    );
  }
}

class _Label extends StatelessWidget {
  final String text;
  const _Label(this.text);
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(0, 18, 0, 6),
        child: Text(text.toUpperCase(), style: const TextStyle(color: Brand.muted, fontWeight: FontWeight.w800, fontSize: 12, letterSpacing: 0.8)),
      );
}

class _PlaceTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? subtitle;
  final VoidCallback onTap;
  const _PlaceTile({required this.icon, required this.title, this.subtitle, required this.onTap});
  @override
  Widget build(BuildContext context) => ListTile(
        contentPadding: EdgeInsets.zero,
        leading: Icon(icon, color: Brand.inkSoft),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: subtitle == null ? null : Text(subtitle!),
        onTap: onTap,
      );
}

/// "📍 Sector 15, Faridabad ▼" — at the top of every major screen.
class LocationBar extends StatelessWidget {
  final Color color;
  const LocationBar({super.key, this.color = Brand.ink});

  @override
  Widget build(BuildContext context) {
    final loc = context.watch<AppState>().location;
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () async {
        final p = await Navigator.of(context).push<PlaceLocation>(MaterialPageRoute(builder: (_) => const LocationPickerScreen()));
        if (p != null && context.mounted) context.read<AppState>().setLocation(p);
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.location_on_rounded, color: Brand.marigold, size: 22),
          const SizedBox(width: 4),
          Flexible(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
              Row(mainAxisSize: MainAxisSize.min, children: [
                Flexible(child: Text(loc?.area ?? loc?.city ?? loc?.label ?? 'Set location', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17, color: color))),
                Icon(Icons.keyboard_arrow_down_rounded, color: color),
              ]),
              if (loc != null && loc.area != null && loc.city != null)
                Text(loc.city!, style: TextStyle(color: color.withValues(alpha: 0.7), fontSize: 12.5, fontWeight: FontWeight.w500)),
            ]),
          ),
        ]),
      ),
    );
  }
}
