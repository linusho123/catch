Feature: The phone handoff
  At the end of a conversation its promises reach the wearer's phone as one
  notification, written as commands, with a second line for promises
  owed to the wearer. The notification opens one screen for that
  conversation; the phone's home is a history of conversations. Nothing
  but promises and kept conversations survives a conversation. Serves N4
  and N10.

  @D28
  Scenario: One notification carries both lines
    Given in a conversation with Dev the wearer said "I'll send you the deck tonight" and "I'll intro you to Sam"
    And Dev said "I'll send you the agenda"
    When ten minutes pass in which the wearer does not speak
    Then the phone shows one notification reading "Send Dev the deck tonight and introduce Dev to Sam"
    And the phone shows a second line in it reading "Owed to you: Dev sends the agenda"
    And a tap on the glasses shows no names from that conversation

  @D28
  Scenario: A long list is cut off and opens in full
    Given in a conversation with Dev the wearer made five promises and Dev made two
    When the conversation ends
    Then the phone shows the notification cut off with an ellipsis
    And opening the notification shows all five of the wearer's promises and both owed promises

  @D51
  Scenario: No promises means no notification
    Given in a conversation Priya and Marcus introduced themselves and nobody promised anything in either direction
    When ten minutes pass in which the wearer does not speak
    Then the phone shows no notification
    And a tap on the glasses shows "this conversation · nothing held"

  @D38
  Scenario: Promises wait for an unreachable phone
    Given a conversation with held promises has ended while the wearer's phone is off
    When the phone comes back on three hours later
    Then the phone shows the same notification then, with every promise intact

  @D39 @D98
  Scenario: Ticking off a promise removes it from the conversation's screen
    Given the wearer has opened a conversation's screen on the phone showing "Send Dev the deck tonight" and "Introduce Dev to Sam" under YOU
    When the wearer ticks off "Send Dev the deck tonight"
    Then the wearer sees only "Introduce Dev to Sam" under YOU

  @D39 @D98
  Scenario: An owed promise can be ticked off the same way
    Given the wearer has opened a conversation's screen on the phone showing "Dev sends the agenda" under OWED TO YOU
    When the wearer ticks off "Dev sends the agenda"
    Then the wearer sees nothing under OWED TO YOU

  @D100
  Scenario: The phone's home lists conversations newest first
    Given today two conversations produced promises, at 9:05 am and 2:10 pm, and yesterday one conversation was kept
    When the wearer opens Catch on the phone
    Then the wearer sees the 2:10 pm conversation above the 9:05 am one under TODAY
    And the wearer sees the kept conversation under YESTERDAY with a kept mark
    And the wearer sees, on each row, the names caught, the time, and the count of open promises

  @D100
  Scenario: A conversation with nothing to keep never appears on the phone
    Given today a conversation produced neither a promise nor a keep
    When the wearer opens Catch on the phone
    Then the wearer sees no row for that conversation

  @D76
  Scenario: An unkept conversation's transcript is deleted everywhere
    Given an unkept conversation with one promise has been running
    When ten minutes pass in which the wearer does not speak
    Then the team, reading the server, finds no transcript and no audio of that conversation
    And the team finds only the promise summary

  @D79
  Scenario: A shared pair delivers to the account holder's phone
    Given two people take turns wearing one pair of glasses signed in to the wearer's account
    When a conversation with promises ends
    Then the account holder's phone shows the notification
    And no other phone shows it
