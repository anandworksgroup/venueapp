import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../state/app_state.dart';
import 'bookings_screen.dart';
import 'explore_screen.dart';
import 'home_screen.dart';
import 'profile_screen.dart';

/// Home · Explore · Bookings · Profile (saved venues live in Explore/Profile).
class Shell extends StatefulWidget {
  Shell() : super(key: shellKey);
  static final GlobalKey<State<Shell>> shellKey = GlobalKey();

  /// Switch bottom-nav tab from anywhere, including routes pushed above the shell.
  static void goTo(int tab) => (shellKey.currentState as _ShellState?)?.select(tab);
  @override
  State<Shell> createState() => _ShellState();
}

class _ShellState extends State<Shell> {
  int _index = 0;
  final _bookingsKey = GlobalKey<BookingsScreenState>();

  void select(int i) {
    setState(() => _index = i);
    if (i == 2) _bookingsKey.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    final unread = context.select<AppState, int>((a) => a.unreadNotifications);
    return Scaffold(
      body: IndexedStack(index: _index, children: [
        const HomeScreen(),
        const ExploreScreen(),
        BookingsScreen(key: _bookingsKey),
        const ProfileScreen(),
      ]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: select,
        destinations: [
          const NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home_rounded), label: 'Home'),
          const NavigationDestination(icon: Icon(Icons.explore_outlined), selectedIcon: Icon(Icons.explore_rounded), label: 'Explore'),
          const NavigationDestination(icon: Icon(Icons.event_note_outlined), selectedIcon: Icon(Icons.event_note_rounded), label: 'Bookings'),
          NavigationDestination(
            icon: Badge(isLabelVisible: unread > 0, label: Text('$unread'), child: const Icon(Icons.person_outline_rounded)),
            selectedIcon: const Icon(Icons.person_rounded),
            label: 'Profile',
          ),
        ],
      ),
    );
  }
}
