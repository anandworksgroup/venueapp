import 'dart:math';

import 'package:flutter/material.dart';

/// Generated venue artwork used until a venue uploads real photos: a dusk
/// sky in the venue's hue, a festive canopy (pandal) silhouette and string
/// lights. Deterministic per venue id so each venue keeps its look.
class CoverArt extends StatelessWidget {
  final int hue;
  final String seed;
  final String? imageUrl;
  final double radius;
  final Widget? child;

  const CoverArt({super.key, required this.hue, required this.seed, this.imageUrl, this.radius = 0, this.child});

  @override
  Widget build(BuildContext context) {
    final art = CustomPaint(painter: _CoverPainter(hue.toDouble(), seed.hashCode), child: const SizedBox.expand());
    final content = imageUrl == null
        ? art
        : Image.network(
            imageUrl!,
            fit: BoxFit.cover,
            width: double.infinity,
            height: double.infinity,
            errorBuilder: (_, __, ___) => art,
            loadingBuilder: (c, w, p) => p == null ? w : art,
          );
    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: Stack(fit: StackFit.expand, children: [content, if (child != null) child!]),
    );
  }
}

class _CoverPainter extends CustomPainter {
  final double hue;
  final int seed;
  _CoverPainter(this.hue, this.seed);

  Color _hsl(double h, double s, double l, [double a = 1]) => HSLColor.fromAHSL(a, h % 360, s, l).toColor();

  @override
  void paint(Canvas canvas, Size size) {
    final rnd = Random(seed);
    final w = size.width, h = size.height;
    final rect = Offset.zero & size;

    // Sky
    canvas.drawRect(
      rect,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [_hsl(hue, 0.55, 0.30), _hsl(hue + 25, 0.65, 0.52), _hsl(hue + 40, 0.80, 0.72)],
          stops: const [0, 0.62, 1],
        ).createShader(rect),
    );

    // Soft glow / moon
    final glow = Offset(w * (0.15 + rnd.nextDouble() * 0.7), h * (0.18 + rnd.nextDouble() * 0.15));
    canvas.drawCircle(glow, h * 0.28, Paint()..color = Colors.white.withValues(alpha: 0.10));
    canvas.drawCircle(glow, h * 0.09, Paint()..color = _hsl(hue + 50, 0.9, 0.9, 0.85));

    // Distant trees
    final trees = Path()..moveTo(0, h * 0.72);
    for (double x = 0; x <= w; x += w / 14) {
      trees.quadraticBezierTo(x + w / 28, h * (0.62 + rnd.nextDouble() * 0.06), x + w / 14, h * 0.72);
    }
    trees
      ..lineTo(w, h)
      ..lineTo(0, h)
      ..close();
    canvas.drawPath(trees, Paint()..color = _hsl(hue + 180, 0.25, 0.18, 0.55));

    // Canopy (pandal) — scalloped roof on poles
    final left = w * 0.18, right = w * 0.82, roofY = h * 0.50, baseY = h * 0.86;
    final canopy = _hsl(hue + 10, 0.35, 0.96);
    final shadow = _hsl(hue, 0.4, 0.22, 0.6);
    final roof = Path()
      ..moveTo(left - w * 0.04, roofY)
      ..lineTo(w * 0.5, h * 0.34)
      ..lineTo(right + w * 0.04, roofY)
      ..close();
    canvas.drawPath(roof, Paint()..color = canopy);
    final scallops = 7;
    final sw = (right - left + w * 0.08) / scallops;
    for (var i = 0; i < scallops; i++) {
      final cx = left - w * 0.04 + sw * i + sw / 2;
      canvas.drawArc(Rect.fromCenter(center: Offset(cx, roofY), width: sw, height: sw * 0.7), 0, pi, true,
          Paint()..color = i.isEven ? _hsl(hue + 35, 0.85, 0.58) : canopy);
    }
    final pole = Paint()
      ..color = shadow
      ..strokeWidth = max(2, w * 0.008);
    for (final x in [left, w * 0.5, right]) {
      canvas.drawLine(Offset(x, roofY + sw * 0.3), Offset(x, baseY), pole);
    }
    // Stage glow under the canopy
    canvas.drawRect(
      Rect.fromLTRB(left, roofY + sw * 0.35, right, baseY),
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [_hsl(hue + 40, 0.9, 0.75, 0.55), _hsl(hue + 40, 0.9, 0.6, 0.15)],
        ).createShader(Rect.fromLTRB(left, roofY, right, baseY)),
    );

    // String lights
    final lights = Paint()..color = const Color(0xFFFFE7A3);
    for (var s = 0; s < 2; s++) {
      final y0 = h * (0.12 + s * 0.1);
      for (double x = 0; x <= w; x += w / 22) {
        final y = y0 + sin(x / w * pi) * h * 0.06;
        canvas.drawCircle(Offset(x, y), max(1.4, w * 0.006), lights);
        canvas.drawCircle(Offset(x, y), max(3, w * 0.014), Paint()..color = const Color(0x33FFE7A3));
      }
    }

    // Ground
    canvas.drawRect(Rect.fromLTRB(0, baseY, w, h), Paint()..color = _hsl(hue + 120, 0.30, 0.22));
  }

  @override
  bool shouldRepaint(covariant _CoverPainter old) => old.hue != hue || old.seed != seed;
}
