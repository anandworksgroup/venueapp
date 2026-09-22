import 'package:flutter/material.dart';

/// Pandal's visual identity: deep teal + marigold on warm cream.
class Brand {
  static const teal = Color(0xFF0F5F5C);
  static const tealDark = Color(0xFF0A4644);
  static const tealSoft = Color(0xFFE3F0EE);
  static const marigold = Color(0xFFE8900C);
  static const marigoldSoft = Color(0xFFFFF1DB);
  static const ink = Color(0xFF1B1B1F);
  static const inkSoft = Color(0xFF5E5E66);
  static const muted = Color(0xFF8B8A90);
  static const cream = Color(0xFFFBF8F3);
  static const line = Color(0xFFE9E4DA);
  static const surface = Colors.white;

  static const available = Color(0xFF1F8A4C);
  static const limited = Color(0xFFD99A00);
  static const booked = Color(0xFFC0392B);
  static const unavailable = Color(0xFFBDBBB6);
  static const danger = Color(0xFFB3261E);

  static Color statusColor(String s) => switch (s) {
        'available' => available,
        'limited' || 'partial' => limited,
        'booked' => booked,
        _ => unavailable,
      };
}

ThemeData buildTheme() {
  final base = ThemeData(
    useMaterial3: true,
    colorScheme: ColorScheme.fromSeed(
      seedColor: Brand.teal,
      primary: Brand.teal,
      secondary: Brand.marigold,
      surface: Brand.surface,
    ),
    scaffoldBackgroundColor: Brand.cream,
    fontFamily: 'Roboto',
  );
  final text = base.textTheme.apply(bodyColor: Brand.ink, displayColor: Brand.ink);
  return base.copyWith(
    textTheme: text.copyWith(
      headlineMedium: text.headlineMedium?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.5),
      headlineSmall: text.headlineSmall?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.3),
      titleLarge: text.titleLarge?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.2),
      titleMedium: text.titleMedium?.copyWith(fontWeight: FontWeight.w700),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: Brand.cream,
      foregroundColor: Brand.ink,
      elevation: 0,
      scrolledUnderElevation: 0.5,
      centerTitle: false,
      titleTextStyle: TextStyle(color: Brand.ink, fontSize: 18, fontWeight: FontWeight.w800),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: Brand.teal,
        foregroundColor: Colors.white,
        minimumSize: const Size(64, 52),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: Brand.teal,
        minimumSize: const Size(48, 48),
        side: const BorderSide(color: Brand.line, width: 1.5),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: const TextStyle(fontWeight: FontWeight.w700),
      ),
    ),
    chipTheme: base.chipTheme.copyWith(
      backgroundColor: Colors.white,
      selectedColor: Brand.tealSoft,
      side: const BorderSide(color: Brand.line),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)),
      labelStyle: const TextStyle(fontWeight: FontWeight.w600, color: Brand.ink),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: Brand.line)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: Brand.line)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: Brand.teal, width: 1.6)),
    ),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18), side: const BorderSide(color: Brand.line)),
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: Brand.cream,
      showDragHandle: true,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.white,
      indicatorColor: Brand.tealSoft,
      height: 68,
      labelTextStyle: WidgetStateProperty.resolveWith((s) => TextStyle(
            fontSize: 12,
            fontWeight: s.contains(WidgetState.selected) ? FontWeight.w800 : FontWeight.w600,
            color: s.contains(WidgetState.selected) ? Brand.teal : Brand.inkSoft,
          )),
    ),
    dividerTheme: const DividerThemeData(color: Brand.line, space: 1),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: Brand.ink,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
  );
}
