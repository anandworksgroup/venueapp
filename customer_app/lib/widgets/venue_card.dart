import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../data/models.dart';
import '../screens/venue_screen.dart';
import '../state/app_state.dart';
import 'common.dart';
import 'cover_art.dart';
import 'login_sheet.dart';

Future<void> toggleSave(BuildContext context, String venueId) async {
  final app = context.read<AppState>();
  if (!app.loggedIn) {
    final ok = await showLoginSheet(context, reason: 'Sign in to save venues');
    if (!ok || !context.mounted) return;
  }
  try {
    final saved = await app.toggleSaved(venueId);
    if (context.mounted) toast(context, saved ? 'Saved to your list' : 'Removed from saved');
  } catch (e) {
    if (context.mounted) toast(context, errorText(e));
  }
}

void openVenue(BuildContext context, VenueCard v, {SearchQuery? query}) {
  Navigator.of(context).push(MaterialPageRoute(builder: (_) => VenueScreen(venueId: v.id, preview: v, query: query)));
}

String availabilityText(Availability a) {
  final when = dateShort(a.date);
  return switch (a.status) {
    'available' => 'Available $when',
    'limited' => 'Limited slots $when',
    _ => 'Booked $when',
  };
}

/// Full-width result card (search results, saved).
class VenueListCard extends StatelessWidget {
  final VenueCard v;
  final SearchQuery? query;
  const VenueListCard(this.v, {super.key, this.query});

  @override
  Widget build(BuildContext context) {
    final saved = context.select<AppState, bool>((a) => a.savedIds.contains(v.id));
    return InkWell(
      borderRadius: BorderRadius.circular(20),
      onTap: () => openVenue(context, v, query: query),
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(20),
          boxShadow: const [BoxShadow(color: Color(0x14000000), blurRadius: 18, offset: Offset(0, 6))],
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          AspectRatio(
            aspectRatio: 16 / 9,
            child: CoverArt(
              hue: v.coverHue,
              seed: v.id,
              imageUrl: v.coverImage,
              radius: 20,
              child: Stack(children: [
                Positioned(
                  top: 10,
                  right: 10,
                  child: _HeartButton(saved: saved, onTap: () => toggleSave(context, v.id)),
                ),
                Positioned(
                  left: 12,
                  bottom: 12,
                  child: Wrap(spacing: 6, children: [
                    _Tag(v.venueTypeLabel),
                    if (v.bookingMode == 'request') const _Tag('Request to book'),
                  ]),
                ),
              ]),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text(v.name, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontSize: 18), maxLines: 1, overflow: TextOverflow.ellipsis)),
                RatingBadge(rating: v.rating, count: v.ratingCount, compact: true),
              ]),
              const SizedBox(height: 4),
              Row(children: [
                const Icon(Icons.place_outlined, size: 15, color: Brand.muted),
                const SizedBox(width: 3),
                Expanded(
                  child: Text(
                    [if (v.distanceKm != null) '${v.distanceKm} km', v.place].join(' · '),
                    style: const TextStyle(color: Brand.inkSoft, fontSize: 13.5),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (v.ratingCount > 0) Text('${v.ratingCount} reviews', style: const TextStyle(color: Brand.muted, fontSize: 12.5)),
              ]),
              const Padding(padding: EdgeInsets.symmetric(vertical: 10), child: Divider()),
              Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${v.capacityMin ?? 1}–${v.capacityMax ?? '?'} guests', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5)),
                    const SizedBox(height: 2),
                    Text.rich(TextSpan(children: [
                      const TextSpan(text: 'Starting ', style: TextStyle(color: Brand.inkSoft, fontSize: 13)),
                      TextSpan(text: inr(v.startingPrice), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                    ])),
                  ]),
                ),
                if (v.availability != null)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(color: Brand.statusColor(v.availability!.status).withValues(alpha: 0.1), borderRadius: BorderRadius.circular(10)),
                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                      AvailabilityDot(v.availability!.status),
                      const SizedBox(width: 6),
                      Text(availabilityText(v.availability!), style: TextStyle(color: Brand.statusColor(v.availability!.status), fontWeight: FontWeight.w700, fontSize: 12.5)),
                    ]),
                  ),
              ]),
              if (v.matchReasons.length > 1) ...[
                const SizedBox(height: 10),
                Text('Why this venue: ${v.matchReasons.skip(1).join(' · ')}', style: const TextStyle(color: Brand.muted, fontSize: 12), maxLines: 2, overflow: TextOverflow.ellipsis),
              ],
            ]),
          ),
        ]),
      ),
    );
  }
}

/// Compact card for horizontal rails on Home/Explore.
class VenueRailCard extends StatelessWidget {
  final VenueCard v;
  const VenueRailCard(this.v, {super.key});

  @override
  Widget build(BuildContext context) {
    final saved = context.select<AppState, bool>((a) => a.savedIds.contains(v.id));
    return SizedBox(
      width: 236,
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: () => openVenue(context, v),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(
            height: 146,
            child: CoverArt(
              hue: v.coverHue,
              seed: v.id,
              imageUrl: v.coverImage,
              radius: 18,
              child: Stack(children: [
                Positioned(top: 8, right: 8, child: _HeartButton(saved: saved, small: true, onTap: () => toggleSave(context, v.id))),
                if (v.availability != null)
                  Positioned(
                    left: 8,
                    bottom: 8,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(8)),
                      child: Row(mainAxisSize: MainAxisSize.min, children: [
                        AvailabilityDot(v.availability!.status, size: 7),
                        const SizedBox(width: 5),
                        Text(availabilityText(v.availability!), style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700)),
                      ]),
                    ),
                  ),
              ]),
            ),
          ),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(child: Text(v.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
            RatingBadge(rating: v.rating, count: v.ratingCount, compact: true),
          ]),
          const SizedBox(height: 2),
          Text(
            [if (v.distanceKm != null) '${v.distanceKm} km', v.area ?? v.city ?? ''].where((s) => s.isNotEmpty).join(' · '),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: Brand.inkSoft, fontSize: 12.5),
          ),
          const SizedBox(height: 2),
          Text('${inr(v.startingPrice)} onwards · up to ${v.capacityMax} guests', style: const TextStyle(color: Brand.ink, fontSize: 12.5, fontWeight: FontWeight.w600)),
        ]),
      ),
    );
  }
}

class _HeartButton extends StatelessWidget {
  final bool saved;
  final bool small;
  final VoidCallback onTap;
  const _HeartButton({required this.saved, required this.onTap, this.small = false});
  @override
  Widget build(BuildContext context) => Material(
        color: Colors.white.withValues(alpha: 0.92),
        shape: const CircleBorder(),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: Padding(
            padding: EdgeInsets.all(small ? 6 : 8),
            child: Icon(saved ? Icons.favorite_rounded : Icons.favorite_border_rounded,
                size: small ? 18 : 21, color: saved ? const Color(0xFFE0245E) : Brand.ink, semanticLabel: saved ? 'Unsave' : 'Save'),
          ),
        ),
      );
}

class _Tag extends StatelessWidget {
  final String text;
  const _Tag(this.text);
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
        decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.45), borderRadius: BorderRadius.circular(8)),
        child: Text(text, style: const TextStyle(color: Colors.white, fontSize: 11.5, fontWeight: FontWeight.w700)),
      );
}
