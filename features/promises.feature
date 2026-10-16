Feature: Promises
  A commitment in the wearer's own speech is shown for a second and a half
  as a short summary that keeps any stated time or condition, and is held
  until done. A commitment from another person is held in a second list,
  owed to the wearer. Considering something is not a promise. Serves N4
  (promises survive the conversation they were made in) and N1.

  @D17 @D89 @D90 @D91
  Scenario Outline: A catch line appears and fades
    Given the wearer is in a conversation with Dev, whose name was caught earlier, and the lens shows only the dot
    And Dev has just said "<dev said>"
    When <speaker> says "<words>"
    Then within <within> the wearer sees "<line>" in dim text in the lower third of the lens
    And the wearer sees the line fade after a second and a half
    And the wearer then sees only the dot

    Examples:
      | dev said                               | speaker    | words                          | within    | line                                      |
      | come and meet Priya                    | Priya      | Hi, I'm Priya                  | 2 seconds | Priya                                     |
      | are you free tonight?                  | the wearer | I'll send you the deck tonight | 3 seconds | promised · send Dev the deck tonight      |
      | about that deck                        | Dev        | I'll send you the deck tonight | 3 seconds | Dev promised · send the deck tonight      |
      | can you send me the budget by Friday?  | the wearer | Yeah, I'll do it               | 3 seconds | promised · send Dev the budget by Friday  |

  @D89
  Scenario: A promise with no stated time shows the bare action
    Given the wearer is in a conversation with Dev and the lens shows only the dot
    When the wearer says "I'll intro you to Sam"
    Then within three seconds the wearer sees "promised · introduce Dev to Sam" in dim text in the lower third of the lens
    And a tap and a swipe down show "introduce Dev to Sam" held for this conversation

  @D90
  Scenario: A bare yes takes its object from what Dev just asked
    Given Dev has just said "can you send me the budget by Friday?" and the lens shows only the dot
    When the wearer says "Yeah, I'll do it"
    Then within three seconds the wearer sees "promised · send Dev the budget by Friday"
    And a tap and a swipe down show "send Dev the budget by Friday" held for this conversation

  @D47
  Scenario: Thinking about it is not a promise
    Given Dev has just said "would you join the Tuesday meeting?" and the lens shows only the dot
    When the wearer says "I'll think about it"
    Then the wearer sees no line on the lens
    And a tap and a swipe down show nothing held under promises

  @D91
  Scenario: Dev's promise is held in the owed list, apart from the wearer's own
    Given the wearer is in a conversation with Dev, whose name was caught earlier
    And the wearer has promised to send Dev the deck tonight
    When Dev says "I'll send you the agenda"
    Then within three seconds the wearer sees "Dev promised · send the agenda" in dim text for a second and a half
    And a tap and a swipe down show "send Dev the deck tonight" first and "owed: Dev sends the agenda" after it

  @D26
  Scenario: A promise from someone unnamed is held as theirs
    Given the wearer is in a conversation in which nobody has introduced themselves
    When another person says "I'll send you the deck tonight"
    Then within three seconds the wearer sees "they promised · send the deck tonight"
    And a tap and a swipe down show "owed: they send the deck tonight"

  @D26
  Scenario: An owed promise takes the name once it is caught
    Given the owed list holds "they send the deck tonight"
    When that person says "By the way, I'm Dev"
    Then a tap and a swipe down show "owed: Dev sends the deck tonight"
