import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../core/theme.dart';
import '../state/app_state.dart';
import '../widgets/common.dart';
import 'booking_flow.dart';
import 'location_screens.dart';
import 'shell.dart';

/// Logo, one line, loading. No ads, no carousel.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});
  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  @override
  void initState() {
    super.initState();
    _boot();
  }

  Future<void> _boot() async {
    final app = context.read<AppState>();
    await Future.wait([app.init(), Future.delayed(const Duration(milliseconds: 900))]);
    if (!mounted) return;
    // Web: coming back from the payment gateway.
    final qp = Uri.base.queryParameters;
    if (kIsWeb && qp['pay_return'] == '1' && qp['order_id'] != null && app.loggedIn) {
      SystemNavigator.routeInformationUpdated(uri: Uri.parse(Uri.base.path), replace: true);
      final nav = Navigator.of(context);
      nav.pushReplacement(MaterialPageRoute(builder: (_) => Shell()));
      nav.push(MaterialPageRoute(builder: (_) => PaymentReturnScreen(params: Map<String, String>.from(qp))));
      return;
    }
    Navigator.of(context).pushReplacement(PageRouteBuilder(
      transitionDuration: const Duration(milliseconds: 350),
      pageBuilder: (_, __, ___) => app.location == null ? const LocationOnboardingScreen() : Shell(),
      transitionsBuilder: (_, a, __, child) => FadeTransition(opacity: a, child: child),
    ));
  }

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      backgroundColor: Brand.teal,
      body: Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          _Logo(),
          SizedBox(height: 18),
          Wordmark(size: 40, color: Colors.white),
          SizedBox(height: 8),
          Text('Find your perfect venue.', style: TextStyle(color: Color(0xCCFFFFFF), fontSize: 16, fontWeight: FontWeight.w500)),
          SizedBox(height: 40),
          SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: Brand.marigold)),
          SizedBox(height: 10),
          Text('Loading…', style: TextStyle(color: Color(0x99FFFFFF), fontSize: 13)),
        ]),
      ),
    );
  }
}

class _Logo extends StatelessWidget {
  const _Logo();
  @override
  Widget build(BuildContext context) => Container(
        width: 84,
        height: 84,
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(26)),
        child: const Center(child: Icon(Icons.festival_rounded, size: 50, color: Brand.marigold)),
      );
}
