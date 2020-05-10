*** Settings ***
Library    String
Library    Collections

*** Test Cases ***
A Simple Test Case
    Set Test Variable    ${var}    Value
    Test Keyword    ${var}    BBB
    Test Keyword    ${var}    CCC
    Test Keyword    ${var}    DDD

*** Keywords ***
Test Keyword
    [Arguments]    ${aaa}    ${bbb}
    @{list}=    Create List
    Append To List    ${list}    ${aaa}    ${bbb}
    Another Test Keyword    XXX    YYY
    Append To List    ${list}    WWW    ZZZ

Another Test Keyword
    [Arguments]    ${aaa}    ${bbb}
    @{list}=    Create List
    Append To List    ${list}    ${aaa}    ${bbb}
    Append To List    ${list}    XXX    YYY
