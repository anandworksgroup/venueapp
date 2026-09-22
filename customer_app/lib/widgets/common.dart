import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../data/api.dart';

void toast(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));
}

String errorText(Object e) => e is ApiException ? e.message : 'Something went wrong. Please try again.';

class SectionHeader extends StatelessWidget {
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final EdgeInsets padding;
  const SectionHeader(this.title, {super.key, this.subtitle, this.trailing, this.padding = const EdgeInsets.fromLTRB(20, 24, 20, 12)});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: padding,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: Theme.of(context).textTheme.titleLarge),
                if (subtitle != null) ...[
                  const SizedBox(height: 2),
                  Text(subtitle!, style: const TextStyle(color: Brand.muted, fontSize: 13)),
                ],
              ],
            ),
          ),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}

class RatingBadge extends StatelessWidget {
  final double rating;
  final int count;
  final bool compact;
  const RatingBadge({super.key, required this.rating, required this.count, this.compact = false});

  @override
  Widget build(BuildContext context) {
    if (count == 0) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(color: Brand.marigoldSoft, borderRadius: BorderRadius.circular(8)),
        child: const Text('New', style: TextStyle(color: Brand.marigold, fontWeight: FontWeight.w800, fontSize: 12)),
      );
    }
    final color = rating >= 4.0 ? Brand.available : rating >= 3.0 ? Brand.limited : Brand.booked;
    return Row(mainAxisSize: MainAxisSize.min, children: [
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
        decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(8)),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Text(rating.toStringAsFixed(1), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 12.5)),
          const SizedBox(width: 2),
          const Icon(Icons.star_rounded, size: 13, color: Colors.white),
        ]),
      ),
      if (!compact) ...[
        const SizedBox(width: 6),
        Text('$count reviews', style: const TextStyle(color: Brand.inkSoft, fontSize: 12.5, fontWeight: FontWeight.w500)),
      ],
    ]);
  }
}

class StatusPill extends StatelessWidget {
  final String status;
  final String label;
  const StatusPill(this.status, this.label, {super.key});

  static (Color, Color) colors(String s) => switch (s) {
        'CONFIRMED' || 'UPCOMING' => (const Color(0xFFE2F4EA), Brand.available),
        'COMPLETED' => (Brand.tealSoft, Brand.teal),
        'PENDING_PAYMENT' || 'PAYMENT_PROCESSING' || 'REQUESTED' || 'REFUND_PROCESSING' || 'CANCELLATION_REQUESTED' =>
          (Brand.marigoldSoft, const Color(0xFFA86400)),
        'PAYMENT_FAILED' || 'CANCELLED' || 'REJECTED' => (const Color(0xFFFBE4E2), Brand.danger),
        _ => (const Color(0xFFEFEDEA), Brand.inkSoft),
      };

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = colors(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(20)),
      child: Text(label.toUpperCase(), style: TextStyle(color: fg, fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 0.4)),
    );
  }
}

class AvailabilityDot extends StatelessWidget {
  final String status;
  final double size;
  const AvailabilityDot(this.status, {super.key, this.size = 9});
  @override
  Widget build(BuildContext context) =>
      Container(width: size, height: size, decoration: BoxDecoration(color: Brand.statusColor(status), shape: BoxShape.circle));
}

class LoadingView extends StatelessWidget {
  final String? message;
  const LoadingView({super.key, this.message});
  @override
  Widget build(BuildContext context) => Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const SizedBox(width: 28, height: 28, child: CircularProgressIndicator(strokeWidth: 3, color: Brand.teal)),
          if (message != null) ...[const SizedBox(height: 14), Text(message!, style: const TextStyle(color: Brand.inkSoft))],
        ]),
      );
}

class ErrorView extends StatelessWidget {
  final Object error;
  final VoidCallback onRetry;
  const ErrorView({super.key, required this.error, required this.onRetry});
  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Icon(error is ApiException && (error as ApiException).isNetwork ? Icons.wifi_off_rounded : Icons.error_outline_rounded,
                size: 44, color: Brand.muted),
            const SizedBox(height: 12),
            Text(errorText(error), textAlign: TextAlign.center, style: const TextStyle(color: Brand.inkSoft)),
            const SizedBox(height: 16),
            OutlinedButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh_rounded), label: const Text('Try again')),
          ]),
        ),
      );
}

class EmptyView extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? message;
  final Widget? action;
  const EmptyView({super.key, required this.icon, required this.title, this.message, this.action});
  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Container(
              padding: const EdgeInsets.all(18),
              decoration: const BoxDecoration(color: Brand.tealSoft, shape: BoxShape.circle),
              child: Icon(icon, size: 34, color: Brand.teal),
            ),
            const SizedBox(height: 16),
            Text(title, textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleMedium),
            if (message != null) ...[
              const SizedBox(height: 6),
              Text(message!, textAlign: TextAlign.center, style: const TextStyle(color: Brand.inkSoft)),
            ],
            if (action != null) ...[const SizedBox(height: 18), action!],
          ]),
        ),
      );
}

/// A white rounded panel used for detail sections.
class Panel extends StatelessWidget {
  final Widget child;
  final EdgeInsets padding;
  final EdgeInsets margin;
  const Panel({super.key, required this.child, this.padding = const EdgeInsets.all(16), this.margin = const EdgeInsets.symmetric(horizontal: 16)});
  @override
  Widget build(BuildContext context) => Container(
        margin: margin,
        padding: padding,
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18), border: Border.all(color: Brand.line)),
        child: child,
      );
}

class KeyValueRow extends StatelessWidget {
  final String label;
  final String value;
  final bool bold;
  final Color? color;
  const KeyValueRow(this.label, this.value, {super.key, this.bold = false, this.color});
  @override
  Widget build(BuildContext context) {
    final style = TextStyle(fontWeight: bold ? FontWeight.w800 : FontWeight.w500, fontSize: bold ? 16 : 14.5, color: color ?? Brand.ink);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(child: Text(label, style: style.copyWith(color: color ?? (bold ? Brand.ink : Brand.inkSoft)))),
        const SizedBox(width: 12),
        Text(value, style: style),
      ]),
    );
  }
}

/// The brand wordmark: "pandal." with a marigold dot.
class Wordmark extends StatelessWidget {
  final double size;
  final Color color;
  const Wordmark({super.key, this.size = 28, this.color = Brand.teal});
  @override
  Widget build(BuildContext context) => Text.rich(
        TextSpan(children: [
          TextSpan(text: 'pandal', style: TextStyle(color: color, fontWeight: FontWeight.w900, fontSize: size, letterSpacing: -1)),
          TextSpan(text: '.', style: TextStyle(color: Brand.marigold, fontWeight: FontWeight.w900, fontSize: size)),
        ]),
      );
}
