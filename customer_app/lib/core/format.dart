import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

final _inr = NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 0);

/// ₹3,25,000
String inr(num? v) => v == null ? '—' : _inr.format(v);

/// ₹85K · ₹1.2L · ₹2.5Cr — for map markers and compact chips.
String inrShort(num? v) {
  if (v == null) return '—';
  if (v >= 10000000) return '₹${_trim(v / 10000000)}Cr';
  if (v >= 100000) return '₹${_trim(v / 100000)}L';
  if (v >= 1000) return '₹${_trim(v / 1000)}K';
  return '₹$v';
}

String _trim(num x) {
  final s = x.toStringAsFixed(x >= 10 ? 0 : 1);
  return s.endsWith('.0') ? s.substring(0, s.length - 2) : s;
}

DateTime? parseDate(String? s) => s == null ? null : DateTime.tryParse(s);

String isoDate(DateTime d) => DateFormat('yyyy-MM-dd').format(d);

/// 27 Sep 2026
String dateLong(String? s) {
  final d = parseDate(s);
  return d == null ? '—' : DateFormat('d MMM yyyy').format(d);
}

/// 27 Sep
String dateShort(String? s) {
  final d = parseDate(s);
  return d == null ? '—' : DateFormat('d MMM').format(d);
}

/// Sat, 27 Sep
String dateWithDay(String? s) {
  final d = parseDate(s);
  return d == null ? '—' : DateFormat('EEE, d MMM').format(d);
}

String relativeTime(String? iso) {
  final d = parseDate(iso)?.toLocal();
  if (d == null) return '';
  final diff = DateTime.now().difference(d);
  if (diff.inMinutes < 1) return 'just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes} min ago';
  if (diff.inHours < 24) return '${diff.inHours} h ago';
  if (diff.inDays < 30) return '${diff.inDays} d ago';
  return DateFormat('d MMM yyyy').format(d);
}

String titleCase(String s) => s
    .replaceAll('_', ' ')
    .split(' ')
    .map((w) => w.isEmpty ? w : '${w[0].toUpperCase()}${w.substring(1)}')
    .join(' ');

/// Icons for the platform's event categories and facilities.
IconData categoryIcon(String code) => switch (code) {
      'wedding' => Icons.favorite_rounded,
      'reception' => Icons.celebration_rounded,
      'engagement' => Icons.diamond_rounded,
      'birthday' => Icons.cake_rounded,
      'anniversary' => Icons.card_giftcard_rounded,
      'corporate' => Icons.business_center_rounded,
      'conference' => Icons.mic_rounded,
      'seminar' => Icons.co_present_rounded,
      'party' => Icons.nightlife_rounded,
      'baby_shower' => Icons.child_friendly_rounded,
      'kitty_party' => Icons.style_rounded,
      'farewell' => Icons.waving_hand_rounded,
      'exhibition' => Icons.museum_rounded,
      'religious' => Icons.temple_hindu_rounded,
      _ => Icons.auto_awesome_rounded,
    };

IconData facilityIcon(String code) => switch (code) {
      'parking' => Icons.local_parking_rounded,
      'ac' => Icons.ac_unit_rounded,
      'rooms' => Icons.bed_rounded,
      'catering' => Icons.restaurant_rounded,
      'decoration' => Icons.local_florist_rounded,
      'dj' => Icons.queue_music_rounded,
      'generator' => Icons.bolt_rounded,
      'stage' => Icons.theater_comedy_rounded,
      'bridal_room' => Icons.checkroom_rounded,
      'valet' => Icons.car_rental_rounded,
      'wifi' => Icons.wifi_rounded,
      'projector' => Icons.videocam_rounded,
      'wheelchair' => Icons.accessible_rounded,
      'alcohol' => Icons.wine_bar_rounded,
      _ => Icons.check_circle_rounded,
    };

String eventLabel(String? code) => code == null ? 'Event' : (code == 'corporate' ? 'Corporate Event' : titleCase(code));
