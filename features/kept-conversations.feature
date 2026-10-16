Feature: Kept conversations
  A swipe up asks whether to keep the conversation; a tap keeps it and a
  swipe down declines; the prompt waits for one or the other. A kept
  conversation produces a memory jogger on the phone: flat bullets, the
  technical terms in bold, however long the conversation was. Serves N8
  (the key points of a conversation that mattered) and N12 (nothing lost
  on a restart).

  @D40
  Scenario: A swipe up asks whether to keep the conversation
    Given the wearer is mid-conversation and the lens shows only the dot
    When the wearer swipes up
    Then the wearer sees "keep this conversation?" in dim text

  @D40 @D111
  Scenario: A tap keeps the conversation
    Given the lens shows "keep this conversation?"
    When the wearer taps the glasses
    Then the wearer sees "kept" in dim text for a second and a half
    And the wearer then sees only the dot
    And a further swipe up shows "already kept"

  @D40
  Scenario: A swipe down declines without keeping
    Given the lens shows "keep this conversation?"
    When the wearer swipes down
    Then the wearer sees only the dot
    And a further swipe up shows "keep this conversation?" again

  @D41
  Scenario: The prompt waits through a distraction
    Given the wearer has swiped up and the lens shows "keep this conversation?"
    When Dev asks the wearer something and the wearer does not touch the glasses for forty seconds
    Then the wearer still sees "keep this conversation?" at the end of the forty seconds
    And a further swipe up shows the prompt, not "already kept"

  @D42
  Scenario: The prompt returns after a catch line
    Given the wearer has swiped up and the lens shows "keep this conversation?"
    When Priya says "Hi, I'm Priya"
    Then the wearer sees "Priya" in place of the prompt for a second and a half
    And the wearer then sees "keep this conversation?" again
    And a tap shows "Priya" among the held names once the prompt has been answered

  @D54
  Scenario: Swiping up again shows already kept
    Given the wearer has already kept the current conversation and the lens shows only the dot
    When the wearer swipes up again
    Then the wearer sees "already kept" in dim text for a second and a half
    And the wearer then sees only the dot

  @D24 @D99
  Scenario: A kept call produces a jogger
    Given the wearer has been on a twenty-five-minute call with Ana, a PhD candidate, about joining her lab
    And during it the wearer swiped up and tapped to keep the conversation
    When the conversation ends
    Then the phone shows a notification reading "Kept: conversation with Ana"
    And opening it shows one flat list of short bullets in the order things came up, with no sections
    And the wearer sees the technical terms Ana used set in bold inside the bullets
    And the wearer sees the questions raised and the wearer's own promises among the bullets

  @D24 @D62 @D116
  Scenario Outline: A kept conversation of any length gets a jogger
    Given the wearer kept a conversation of <length>
    When the conversation ends
    Then the phone shows a "Kept" notification within <within>
    And opening it shows one flat list of bullets with no sections, as many as the specifics demand

    Examples:
      | length     | within        |
      | 2 minutes  | 30 seconds    |
      | 25 minutes | 30 seconds    |
      | 3 hours    | a few minutes |

  @D53
  Scenario: The jogger admits missed time without saying when
    Given the wearer has marked a conversation to keep
    And partway through it Catch could not hear for four minutes
    When the conversation ends and the jogger is written
    Then the wearer sees one line in the jogger reading "4 minutes not heard"
    And the wearer sees no time of day beside it

  @D73
  Scenario: Everything survives a restart mid-conversation
    Given the wearer is fifteen minutes into a kept conversation in which two promises and three names are held
    When the Even app restarts and Catch comes back one minute later
    Then a tap shows the three names in their original order
    And a tap and a swipe down show both promises
    And a further swipe up shows "already kept"
    And the jogger written at the end covers the whole conversation apart from one minute not heard
