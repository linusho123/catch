Feature: Staying dark
  The lens shows nothing but a dim dot while the wearer talks and nothing
  has slipped. The dot means Catch is listening; a dash means the wearer
  paused it; no mark at all means Catch cannot hear right now. Serves N2
  (nothing shown unless something slipped) and N13 (pause on purpose).

  @D14
  Scenario: Nothing has slipped, so the wearer sees only the dot
    Given the wearer is in a conversation in which nothing has slipped
    When any moment of that conversation passes
    Then the wearer sees a single dim dot at the lowest brightness in the top-right corner of the lens
    And the wearer sees nothing else on the lens

  @D16
  Scenario: Three minutes of talk with nothing to catch leaves the dot alone
    Given the wearer is talking with Dev for three minutes
    And in those three minutes nobody introduces themselves, the wearer makes no promise, and nobody cuts the wearer off
    When the three minutes pass
    Then the wearer has seen nothing on the lens but the dim dot for the whole three minutes

  @D32
  Scenario: The newest catch replaces a page that is showing
    Given the wearer has tapped and the names page is showing
    When Dev says "I'll send you the deck"
    Then the wearer sees the promise line in place of the names page at once
    And the wearer no longer sees the names page
    And a tap and a swipe down show "owed: Dev sends the deck" held for this conversation

  @D37
  Scenario: The dot disappears while Catch cannot hear
    Given the wearer is mid-conversation and the lens shows only the dot
    When Catch loses its connection to speech-to-text for one minute
    Then the wearer sees no dot for that minute
    And the wearer sees the dot return the moment Catch can hear again

  @D86
  Scenario: A swipe down pauses Catch and shows the dash
    Given Catch is listening and the lens shows only the dot
    When the wearer swipes down
    Then the wearer sees "paused" in dim text for a second and a half
    And the wearer then sees a dim dash in the dot's place for as long as the pause lasts
    And nothing said while paused appears on the lens, in the held pages, or in any jogger

  @D86
  Scenario: A second swipe down resumes listening
    Given Catch is paused and the lens shows the dim dash
    When the wearer swipes down
    Then the wearer sees "listening" in dim text for a second and a half
    And the wearer then sees the dot

  @D81
  Scenario: A pause freezes the conversation
    Given the wearer is mid-conversation with Priya's name and one promise held
    And the wearer has been silent for four minutes of the ten-minute quiet
    When the wearer swipes down, stays paused for twelve minutes, and swipes down again
    Then a tap shows Priya still held
    And a tap and a swipe down show the promise still held
    And the phone has received no notification
    And the conversation ends only after six more minutes of the wearer's silence
