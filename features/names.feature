Feature: Names
  An introduction puts the name on the lens for a second and a half and
  keeps it for the conversation. The wearer's own name is never caught.
  Catch cannot tell voices apart, so a repeated name is a second person
  only inside a two-minute window. Serves N3 (the name back, without
  anyone noticing it was lost).

  @D17
  Scenario: An introduction puts the name on the lens
    Given the wearer is in a conversation and the lens shows only the dot
    When Priya says "Hi, I'm Priya"
    Then within two seconds the wearer sees "Priya" in dim text in the lower third of the lens
    And the wearer sees the name fade after a second and a half
    And the wearer then sees only the dot

  @D29
  Scenario: The wearer's own name is not caught
    Given the wearer is in a conversation and the lens shows only the dot
    When the wearer says "Hi, I'm Linus"
    Then the wearer sees no line on the lens
    And a tap shows no "Linus" among the held names

  @D57
  Scenario: A re-introduction later in the conversation keeps one entry
    Given Priya introduced herself at the start of the conversation
    When ten minutes later Priya says "I'm Priya" again to someone who just joined
    Then the wearer sees "Priya" in dim text for a second and a half
    And a tap shows "Priya" once, in her original position

  @D88
  Scenario Outline: A repeated name inside the window
    Given Priya introduced herself at the start of the conversation
    When <later> later someone says "Hi, I'm Priya"
    Then the wearer sees "<line>" in dim text for a second and a half
    And a tap shows the names page listing <page> in the order heard

    Examples:
      | later      | line      | page                  |
      | 90 seconds | Priya (2) | "Priya" and "Priya (2)" |
      | 3 minutes  | Priya     | "Priya" alone           |

  @D88
  Scenario: A third of the same name inside the window
    Given Priya introduced herself and, 60 seconds later, a second person said "Hi, I'm Priya"
    When 30 seconds after that a third person says "Hi, I'm Priya"
    Then the wearer sees "Priya (3)" in dim text for a second and a half
    And a tap shows "Priya", "Priya (2)" and "Priya (3)" in the order heard
